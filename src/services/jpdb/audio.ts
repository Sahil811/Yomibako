// Jpdb audio - fetch hash -> bytes -> play via expo-audio
// Caches hash and bytes in memory + FileSystem cache

import { Paths, File, Directory } from 'expo-file-system';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import { jpdbApi } from './api';

const audioCache = new Map<string, string>(); // hash -> file uri
let currentPlayer: AudioPlayer | null = null;
let lastError = '';

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

export async function playAudioForWord(vid: number, spelling: string): Promise<boolean> {
  try {
    const hash = await jpdbApi.getAudioHash({ vid, spelling });
    if (!hash) {
      lastError = 'No JPDB recording for this word';
      return false;
    }
    lastError = '';
    return playAudioForHash(hash);
  } catch (e: any) {
    lastError = String(e?.message ?? e);
    console.warn('[audio] hash', e);
    return false;
  }
}

export async function playAudioForHash(hash: string): Promise<boolean> {
  try {
    await ensureAudioDir();
    let uri = audioCache.get(hash);
    if (!uri) {
      const file = new File(Paths.cache, 'yomibako', 'audio', `${hash}.mp3`);
      const cacheUri = file.uri;
      if (!file.exists) {
        const buf = await jpdbApi.fetchAudioBytes({ hash });
        if (!buf || buf.byteLength === 0) throw new Error('Empty audio response from JPDB');
        // Convert ArrayBuffer -> base64 without Buffer
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = (globalThis as any).btoa ? (globalThis as any).btoa(binary) : binary;
        try {
          file.create({ intermediates: true });
        } catch {}
        file.write(base64, { encoding: 'base64' });
      }
      uri = cacheUri;
      audioCache.set(hash, uri);
    }
    // Stop previous
    if (currentPlayer) {
      try { currentPlayer.remove(); } catch {}
      currentPlayer = null;
    }
    currentPlayer = createAudioPlayer(uri);
    currentPlayer.play();
    return true;
  } catch (e: any) {
    lastError = String(e?.message ?? e);
    console.warn('[audio] play', e);
    // Self-heal: a corrupt cached mp3 would otherwise be reused forever
    // (file.exists short-circuit) → permanent silence with no error.
    audioCache.delete(hash);
    try {
      new File(Paths.cache, 'yomibako', 'audio', `${hash}.mp3`).delete();
    } catch {}
    return false;
  }
}

export function stopAudio() {
  if (currentPlayer) {
    try { currentPlayer.pause(); } catch {}
  }
}
