import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deobfuscate,
  sniffExtension,
  unsupportedOnThisPlatform,
  JPDB_XOR_KEY,
  lastAudioError,
  stopAudio,
  playRemoteAudio,
  __resetAudioForTests,
} from '../audio';
import { Platform } from 'react-native';

function bytes(s: string): Uint8Array {
  return Uint8Array.from(s.split('').map((c) => c.charCodeAt(0)));
}

test('deobfuscate xors first four bytes and roundtrips', () => {
  const original = bytes('OggSxxxx');
  const masked = Uint8Array.from(original);
  for (let i = 0; i < 4; i++) masked[i] ^= JPDB_XOR_KEY[i];
  assert.deepEqual(deobfuscate(masked), original);
  assert.equal(deobfuscate(new Uint8Array(0)).length, 0);
});

test('sniffExtension detects containers', () => {
  assert.equal(sniffExtension(bytes('OggSxxxx')), 'ogg');
  assert.equal(sniffExtension(bytes('fLaCxxxx')), 'flac');
  assert.equal(sniffExtension(bytes('RIFFxxxx')), 'wav');
  assert.equal(sniffExtension(Uint8Array.from([0, 0, 0, 0, 102, 116, 121, 112])), 'm4a');
  assert.equal(sniffExtension(bytes('ID3xxxx')), 'mp3');
  assert.equal(sniffExtension(Uint8Array.from([0xff, 0xe0, 0, 0])), 'mp3');
  assert.equal(sniffExtension(bytes('ZZZZ')), 'bin');
  assert.equal(sniffExtension(new Uint8Array(0)), 'bin');
});

test('unsupportedOnThisPlatform gates ogg/flac on ios only', () => {
  (Platform as any).OS = 'ios';
  assert.ok(unsupportedOnThisPlatform('ogg'));
  assert.ok(unsupportedOnThisPlatform('flac'));
  assert.equal(unsupportedOnThisPlatform('mp3'), null);
  (Platform as any).OS = 'android';
  assert.equal(unsupportedOnThisPlatform('ogg'), null);
  assert.equal(unsupportedOnThisPlatform('flac'), null);
});

test('playRemoteAudio rejects empty uri and stopAudio resets', async () => {
  __resetAudioForTests();
  let reason = '';
  assert.equal(await playRemoteAudio('', { onFinished: (r) => { reason = r; } }), false);
  assert.equal(reason, 'error');
  assert.ok(lastAudioError().length > 0);
  stopAudio(); // must not throw
  assert.equal(await playRemoteAudio('https://x/y.mp3'), true);
});

test('playAudioForHash decodes, caches and reuses', async () => {
  __resetAudioForTests();
  (Platform as any).OS = 'android';
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  __resetFS();
  const api = await import('../api');
  const { JPDB_XOR_KEY } = await import('../audio');
  const ogg = [79, 103, 103, 83, 1, 2, 3]; // OggS...
  const masked = ogg.map((b, i) => (i < 4 ? b ^ JPDB_XOR_KEY[i] : b));
  let fetches = 0;
  const orig = (api.jpdbApi as any).fetchAudioBytes;
  (api.jpdbApi as any).fetchAudioBytes = async () => {
    fetches++;
    return new Uint8Array(masked).buffer as ArrayBuffer;
  };
  try {
    const { playAudioForHash, clearAudioCache } = await import('../audio');
    assert.equal(await playAudioForHash('h1'), true);
    assert.equal(fetches, 1);
    assert.equal(await playAudioForHash('h1'), true, 'second call hits memory cache');
    assert.equal(fetches, 1);
    clearAudioCache();
  } finally {
    (api.jpdbApi as any).fetchAudioBytes = orig;
  }
});

test('playAudioForHash fails on empty bytes and iOS ogg', async () => {
  __resetAudioForTests();
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  __resetFS();
  const api = await import('../api');
  const orig = (api.jpdbApi as any).fetchAudioBytes;
  try {
    (api.jpdbApi as any).fetchAudioBytes = async () => new ArrayBuffer(0);
    const { playAudioForHash } = await import('../audio');
    (Platform as any).OS = 'android';
    assert.equal(await playAudioForHash('empty'), false);
    // iOS blocks ogg
    const { JPDB_XOR_KEY } = await import('../audio');
    const ogg = [79, 103, 103, 83];
    const masked = ogg.map((b, i) => b ^ JPDB_XOR_KEY[i]);
    (api.jpdbApi as any).fetchAudioBytes = async () => new Uint8Array(masked).buffer as ArrayBuffer;
    (Platform as any).OS = 'ios';
    __resetAudioForTests();
    __resetFS();
    assert.equal(await playAudioForHash('ogg1'), false);
    assert.ok(lastAudioError().toLowerCase().includes('ios') || lastAudioError().includes('Ogg'));
  } finally {
    (api.jpdbApi as any).fetchAudioBytes = orig;
    (Platform as any).OS = 'android';
  }
});

test('player status callbacks drive lastError and finish', async () => {
  __resetAudioForTests();
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  const audioMock = await import('../../../../test/mocks/expo-audio');
  (__resetFS as any)();
  (audioMock as any).__resetAudioMock();
  (Platform as any).OS = 'android';
  const api = await import('../api');
  const orig = (api.jpdbApi as any).fetchAudioBytes;
  (api.jpdbApi as any).fetchAudioBytes = async () => new Uint8Array([90, 90, 90, 90]).buffer as ArrayBuffer;
  try {
    const audio = await import('../audio');
    assert.equal(await audio.playAudioForHash('cb1'), true);
    (audioMock as any).__emitAudioStatus({ isLoaded: true });
    assert.equal(audio.lastAudioError(), '');
    (audioMock as any).__emitAudioStatus({ isLoaded: true, error: 'decode!' });
    assert.equal(audio.lastAudioError(), 'decode!');
    // remote loop path swallows didJustFinish when looping
    let finished = '';
    assert.equal(await audio.playRemoteAudio('https://x/y.mp3', { loop: true, onFinished: (r) => { finished = r; } }), true);
    (audioMock as any).__emitAudioStatus({ isLoaded: true, didJustFinish: true });
    assert.equal(finished, '', 'looping does not finish');
    assert.equal(await audio.playRemoteAudio('https://x/z.mp3', { onFinished: (r) => { finished = r; } }), true);
    (audioMock as any).__emitAudioStatus({ isLoaded: true, didJustFinish: true });
    assert.equal(finished, 'ended');
    // remote error path releases with 'error'
    let r2 = '';
    assert.equal(await audio.playRemoteAudio('https://x/e.mp3', { onFinished: (r) => { r2 = r; } }), true);
    (audioMock as any).__emitAudioStatus({ error: 'net down' });
    assert.equal(r2, 'error');
    assert.equal(audio.lastAudioError(), 'net down');
  } finally {
    (api.jpdbApi as any).fetchAudioBytes = orig;
  }
});

test('playRemoteAudio create failure calls onFinished error', async () => {
  __resetAudioForTests();
  const audioMock = await import('../../../../test/mocks/expo-audio');
  const origCreate = (audioMock as any).createAudioPlayer;
  (audioMock as any).createAudioPlayer = () => { throw new Error('no player'); };
  try {
    const audio = await import('../audio');
    let reason = '';
    assert.equal(await audio.playRemoteAudio('https://x/y.mp3', { onFinished: (r) => { reason = r; } }), false);
    assert.equal(reason, 'error');
  } finally {
    (audioMock as any).createAudioPlayer = origCreate;
  }
});

test('audio mode/player failures are swallowed, not thrown', async () => {
  __resetAudioForTests();
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  (__resetFS as any)();
  (Platform as any).OS = 'android';
  const audioMock = await import('../../../../test/mocks/expo-audio');
  const api = await import('../api');
  const origMode = (audioMock as any).setAudioModeAsync;
  const origCreate = (audioMock as any).createAudioPlayer;
  const origBytes = (api.jpdbApi as any).fetchAudioBytes;
  (api.jpdbApi as any).fetchAudioBytes = async () => new Uint8Array([90, 90, 90, 90]).buffer as ArrayBuffer;
  try {
    (audioMock as any).setAudioModeAsync = async () => { throw new Error('no focus'); };
    const audio = await import('../audio');
    // ensureAudioMode warns but playback still proceeds
    assert.equal(await audio.playAudioForHash('m1'), true);
    (audioMock as any).setAudioModeAsync = origMode;
    __resetAudioForTests();
    (__resetFS as any)();
    (audioMock as any).createAudioPlayer = () => { throw new Error('no decoder'); };
    assert.equal(await audio.playAudioForHash('m2'), false);
  } finally {
    (audioMock as any).setAudioModeAsync = origMode;
    (audioMock as any).createAudioPlayer = origCreate;
    (api.jpdbApi as any).fetchAudioBytes = origBytes;
  }
});

test('unloaded decoder is reported after the grace timer', async () => {
  __resetAudioForTests();
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  (__resetFS as any)();
  (Platform as any).OS = 'android';
  const audioMock = await import('../../../../test/mocks/expo-audio');
  const api = await import('../api');
  const origBytes = (api.jpdbApi as any).fetchAudioBytes;
  const origCreate = (audioMock as any).createAudioPlayer;
  const origSetTimeout = globalThis.setTimeout;
  (api.jpdbApi as any).fetchAudioBytes = async () => new Uint8Array([90, 90, 90, 90]).buffer as ArrayBuffer;
  (audioMock as any).createAudioPlayer = (uri: string) => ({
    ...origCreate(uri),
    isLoaded: false,
  });
  // Fire 4s grace timers immediately; delegate everything else.
  (globalThis as any).setTimeout = ((cb: any, ms?: any, ...rest: any[]) => {
    if (ms === 4000) {
      cb();
      return 0 as any;
    }
    return origSetTimeout(cb, ms, ...rest);
  }) as any;
  try {
    const audio = await import('../audio');
    assert.equal(await audio.playAudioForHash('grace'), true);
    assert.equal(audio.lastAudioError(), 'Decoder could not load the recording');
  } finally {
    (globalThis as any).setTimeout = origSetTimeout;
    (audioMock as any).createAudioPlayer = origCreate;
    (api.jpdbApi as any).fetchAudioBytes = origBytes;
  }
});

test('stale requests and broken caches fail safe', async () => {
  __resetAudioForTests();
  const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
  (__resetFS as any)();
  (Platform as any).OS = 'android';
  const api = await import('../api');
  const audio = await import('../audio');
  const origBytes = (api.jpdbApi as any).fetchAudioBytes;
  try {
    // Stale hash fetch error: the superseded request rejects after a fresh one wins.
    // Wait until the stale request is inside fetch (past the early staleness
    // check) before superseding, so the CATCH-path staleness guard is covered.
    let rejectFirst!: (e: any) => void;
    const gate = new Promise<never>((_, rej) => { rejectFirst = rej; });
    gate.catch(() => {});
    let fetchingStale = false;
    (api.jpdbApi as any).fetchAudioBytes = (a: any) => {
      if (a?.hash === 'stale-x') {
        fetchingStale = true;
        return gate;
      }
      return new Uint8Array([90, 90, 90, 90]).buffer as ArrayBuffer;
    };
    const p1 = audio.playAudioForHash('stale-x');
    const p1quiet = p1.then(
      (v) => v,
      () => 'threw',
    );
    while (!fetchingStale) await new Promise((r) => setTimeout(r, 5));
    audio.stopAudio();
    assert.equal(await audio.playAudioForHash('fresh-x'), true);
    rejectFirst(new Error('late failure'));
    assert.equal(await p1quiet, false);
    // Corrupt-file self-heal tolerates delete failures.
    const fsMock = await import('../../../../test/mocks/expo-file-system');
    const origDelete = (fsMock as any).File.prototype.delete;
    (fsMock as any).File.prototype.delete = function () { throw new Error('readonly'); };
    (api.jpdbApi as any).fetchAudioBytes = async () => new ArrayBuffer(0);
    __resetAudioForTests();
    (__resetFS as any)();
    assert.equal(await audio.playAudioForHash('corrupt-x'), false);
    (fsMock as any).File.prototype.delete = origDelete;
  } finally {
    (api.jpdbApi as any).fetchAudioBytes = origBytes;
  }
});

test('superseded remote playback and throwing players release cleanly', async () => {
  __resetAudioForTests();
  const audioMock = await import('../../../../test/mocks/expo-audio');
  const audio = await import('../audio');
  const origMode = (audioMock as any).setAudioModeAsync;
  const origCreate = (audioMock as any).createAudioPlayer;
  try {
    // Deferred audio mode lets stopAudio() supersede the request.
    let releaseMode!: () => void;
    const gate = new Promise<void>((r) => { releaseMode = r; });
    (audioMock as any).setAudioModeAsync = () => gate;
    const pr = audio.playRemoteAudio('https://x/slow.mp3');
    audio.stopAudio();
    releaseMode();
    assert.equal(await pr, false);
    (audioMock as any).setAudioModeAsync = origMode;
    __resetAudioForTests();
    // play() throwing with a live player releases with 'error'.
    (audioMock as any).createAudioPlayer = () => ({
      ...origCreate('x'),
      play: () => { throw new Error('speaker busy'); },
    });
    let reason = '';
    assert.equal(
      await audio.playRemoteAudio('https://x/y.mp3', { onFinished: (r) => { reason = r; } }),
      false,
    );
    assert.equal(reason, 'error');
  } finally {
    (audioMock as any).setAudioModeAsync = origMode;
    (audioMock as any).createAudioPlayer = origCreate;
  }
});

test('playAudioForWord handles hash miss and errors', async () => {
  __resetAudioForTests();
  const api = await import('../api');
  const origHash = (api.jpdbApi as any).getAudioHash;
  const origBytes = (api.jpdbApi as any).fetchAudioBytes;
  try {
    (api.jpdbApi as any).getAudioHash = async () => null;
    const { playAudioForWord } = await import('../audio');
    assert.equal(await playAudioForWord(1, '猫'), false);
    (api.jpdbApi as any).getAudioHash = async () => { throw new Error('net'); };
    __resetAudioForTests();
    assert.equal(await playAudioForWord(1, '猫'), false);
    (api.jpdbApi as any).getAudioHash = async () => 'h2';
    (api.jpdbApi as any).fetchAudioBytes = async () => new Uint8Array([90, 90, 90, 90]).buffer as ArrayBuffer;
    __resetAudioForTests();
    const { __resetFS } = await import('../../../../test/mocks/expo-file-system');
    __resetFS();
    (Platform as any).OS = 'android';
    assert.equal(await playAudioForWord(1, '猫'), true);
  } finally {
    (api.jpdbApi as any).getAudioHash = origHash;
    (api.jpdbApi as any).fetchAudioBytes = origBytes;
  }
});
