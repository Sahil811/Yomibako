// JPDB audio — fetch hash -> bytes -> de-obfuscate -> play via expo-audio.
// Caches decoded files under cacheDirectory/yomibako/audio.
//
// JPDB masks the first four bytes of every recording: the response starts with
// "ID3\" so it looks like an MP3, and XOR-ing those bytes with JPDB_XOR_KEY
// restores the real "OggS" magic. Without that step the header is garbage and
// every decoder refuses the file — which is exactly why playback was silent.
// (Same trick jpd-breader does in content/popup_audio.js.)

import { Platform } from 'react-native';
import { Paths, File, Directory } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import { jpdbApi } from './api';

export const JPDB_XOR_KEY = [0x06, 0x23, 0x54, 0x0f];
export const AUDIO_EXTS = ['ogg', 'mp3', 'm4a', 'wav', 'flac', 'bin'];

const audioCache = new Map<string, string>(); // hash -> file uri
let currentPlayer: AudioPlayer | null = null;
let currentPlayerSubscription: { remove: () => void } | null = null;
let currentRemoteFinished: ((reason: RemoteAudioFinishReason) => void) | null = null;
let lastError = '';
let audioModeReady = false;
let playbackGeneration = 0;

export type RemoteAudioFinishReason = 'ended' | 'stopped' | 'error';

function releaseCurrentPlayer(reason: RemoteAudioFinishReason = 'stopped') {
  const finished = currentRemoteFinished;
  currentRemoteFinished = null;
  try { currentPlayerSubscription?.remove(); } catch {}
  currentPlayerSubscription = null;
  if (currentPlayer) {
    try { currentPlayer.remove(); } catch {}
  }
  currentPlayer = null;
  finished?.(reason);
}

// Equivalent to JPDB Breader's lastPlayId: reserve ownership before any
// network/audio-mode await, stop the old player immediately, and let every
// continuation prove it is still the newest request before creating audio.
function beginPlaybackRequest(): number {
  const generation = ++playbackGeneration;
  releaseCurrentPlayer('stopped');
  return generation;
}

function isCurrentRequest(generation: number): boolean {
  return generation === playbackGeneration;
}

/** Last audio failure reason — surfaced in Settings → Diagnostics. */
export function lastAudioError(): string {
  return lastError;
}

async function ensureAudioDir() {
  const dir = new Directory(Paths.cache, 'yomibako', 'audio');
  if (!dir.exists) {
    try {
      dir.create({ intermediates: true, idempotent: true });
    } catch {}
  }
}

// Without this the iOS ringer switch silences playback outright and Android
// never takes audio focus — both look identical to "audio is broken".
async function ensureAudioMode() {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
  } catch (e) {
    console.warn('[audio] setAudioMode', e);
  }
}

/** Undo JPDB's 4-byte header mask, in place. */
export function deobfuscate(bytes: Uint8Array): Uint8Array {
  for (let i = 0; i < Math.min(JPDB_XOR_KEY.length, bytes.length); i++) {
    bytes[i] ^= JPDB_XOR_KEY[i];
  }
  return bytes;
}

// The extension decides which extractor ExoPlayer/AVFoundation picks, so it has
// to match the real container rather than a hardcoded ".mp3".
export function sniffExtension(b: Uint8Array): string {
  const at = (i: number) => (i < b.length ? b[i] : -1);
  const ascii = (start: number, text: string) =>
    text.split('').every((c, i) => at(start + i) === c.charCodeAt(0));
  if (ascii(0, 'OggS')) return 'ogg';
  if (ascii(0, 'fLaC')) return 'flac';
  if (ascii(0, 'RIFF')) return 'wav';
  if (ascii(4, 'ftyp')) return 'm4a';
  if (ascii(0, 'ID3')) return 'mp3';
  if (at(0) === 0xff && (at(1) & 0xe0) === 0xe0) return 'mp3';
  return 'bin';
}

// JPDB serves Ogg/Opus. ExoPlayer decodes it; AVFoundation has no Ogg demuxer
// at all, so say so rather than failing silently.
export function unsupportedOnThisPlatform(ext: string): string | null {
  if (Platform.OS === 'ios' && (ext === 'ogg' || ext === 'flac')) {
    return 'JPDB serves Ogg/Opus recordings, which iOS cannot decode';
  }
  return null;
}

// Hashes look like "m1/c2faa602210f" — the slash would create a subdirectory.
export function cachedFileFor(hash: string, ext: string) {
  return new File(Paths.cache, 'yomibako', 'audio', `${hash.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`);
}

export async function playAudioForWord(vid: number, spelling: string): Promise<boolean> {
  const generation = beginPlaybackRequest();
  try {
    const hash = await jpdbApi.getAudioHash({ vid, spelling });
    if (!isCurrentRequest(generation)) return false;
    if (!hash) {
      lastError = 'No JPDB recording for this word';
      return false;
    }
    lastError = '';
    return playAudioForHashRequest(hash, generation);
  } catch (e: any) {
    if (!isCurrentRequest(generation)) return false;
    lastError = String(e?.message ?? e);
    console.warn('[audio] hash', e);
    return false;
  }
}

export async function playAudioForHash(hash: string): Promise<boolean> {
  const generation = beginPlaybackRequest();
  return playAudioForHashRequest(hash, generation);
}

async function playAudioForHashRequest(hash: string, generation: number): Promise<boolean> {
  try {
    await ensureAudioDir();
    await ensureAudioMode();
    if (!isCurrentRequest(generation)) return false;

    let uri = audioCache.get(hash);
    if (!uri) {
      const buf = await jpdbApi.fetchAudioBytes({ hash });
      if (!isCurrentRequest(generation)) return false;
      if (!buf || buf.byteLength === 0) throw new Error('Empty audio response from JPDB');
      const bytes = deobfuscate(new Uint8Array(buf));
      const ext = sniffExtension(bytes);

      const blocked = unsupportedOnThisPlatform(ext);
      if (blocked) {
        lastError = blocked;
        return false;
      }

      const file = cachedFileFor(hash, ext);
      if (!file.exists) {
        try {
          file.create({ intermediates: true, overwrite: true });
        } catch {}
      }
      // Write the raw bytes. The old base64 path relied on a global btoa(),
      // which React Native does not provide — it silently fell back to writing
      // the latin-1 binary string *tagged as base64*, producing a junk file.
      file.write(bytes);
      uri = file.uri;
      audioCache.set(hash, uri);
    }

    if (!isCurrentRequest(generation)) return false;

    const player = createAudioPlayer(uri);
    currentPlayer = player;
    // A source the decoder rejects never reports isLoaded — surface that
    // instead of leaving the user with silence and a blank diagnostics line.
    try {
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (!isCurrentRequest(generation) || currentPlayer !== player) return;
        if (status.isLoaded) {
          lastError = '';
        }
        if (status.error) {
          lastError = status.error;
          releaseCurrentPlayer('error');
        } else if (status.didJustFinish) releaseCurrentPlayer('ended');
      });
      currentPlayerSubscription = sub;
      setTimeout(() => {
        try {
          if (isCurrentRequest(generation) && currentPlayer === player && !player.isLoaded) {
            lastError = 'Decoder could not load the recording';
          }
        } catch {}
      }, 4000);
    } catch {}
    player.play();
    return true;
  } catch (e: any) {
    if (!isCurrentRequest(generation)) return false;
    lastError = String(e?.message ?? e);
    console.warn('[audio] play', e);
    releaseCurrentPlayer('error');
    // Self-heal: a corrupt cached file would otherwise be reused forever
    // (file.exists short-circuit) → permanent silence with no error.
    audioCache.delete(hash);
    for (const ext of AUDIO_EXTS) {
      try { cachedFileFor(hash, ext).delete(); } catch {}
    }
    return false;
  }
}

/** Play a normal remote clip, such as an ImmersionKit example. */
export async function playRemoteAudio(
  uri: string,
  options: {
    loop?: boolean;
    onFinished?: (reason: RemoteAudioFinishReason) => void;
  } = {}
): Promise<boolean> {
  if (!uri) {
    lastError = 'This example has no audio';
    options.onFinished?.('error');
    return false;
  }
  const generation = beginPlaybackRequest();
  try {
    await ensureAudioMode();
    if (!isCurrentRequest(generation)) return false;
    const player = createAudioPlayer(uri, { downloadFirst: true });
    currentPlayer = player;
    currentRemoteFinished = options.onFinished ?? null;
    player.loop = !!options.loop;
    currentPlayerSubscription = player.addListener('playbackStatusUpdate', (status) => {
      if (!isCurrentRequest(generation) || currentPlayer !== player) return;
      if (status.error) {
        lastError = status.error;
        releaseCurrentPlayer('error');
        return;
      }
      if (status.isLoaded) lastError = '';
      if (status.didJustFinish && !options.loop) releaseCurrentPlayer('ended');
    });
    player.play();
    return true;
  } catch (e: any) {
    if (!isCurrentRequest(generation)) return false;
    lastError = String(e?.message ?? e);
    console.warn('[audio] remote play', e);
    if (currentPlayer) releaseCurrentPlayer('error');
    else options.onFinished?.('error');
    return false;
  }
}

export function stopAudio() {
  playbackGeneration++;
  releaseCurrentPlayer();
}

/** Test-only: reset in-memory playback/cache state. */
export function __resetAudioForTests() {
  audioCache.clear();
  currentPlayer = null;
  currentPlayerSubscription = null;
  currentRemoteFinished = null;
  lastError = '';
  audioModeReady = false;
  playbackGeneration = 0;
}

/** Drop every cached recording — files written before the de-obfuscation fix are junk. */
export function clearAudioCache() {
  audioCache.clear();
  try {
    const dir = new Directory(Paths.cache, 'yomibako', 'audio');
    if (dir.exists) dir.delete();
  } catch {}
}
