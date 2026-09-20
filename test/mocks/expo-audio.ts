// Minimal expo-audio double.
export type AudioPlayer = {
  play: () => void;
  remove: () => void;
  addListener: (ev: string, cb: (s: any) => void) => { remove: () => void };
  loop: boolean;
  isLoaded: boolean;
};

export async function setAudioModeAsync(_opts?: any): Promise<void> {}

type Listener = (s: any) => void;
const listeners: Listener[] = [];

export function __emitAudioStatus(s: any) {
  for (const cb of [...listeners]) {
    try { cb(s); } catch {}
  }
}

export function __resetAudioMock() {
  listeners.length = 0;
}

export function createAudioPlayer(_uri: string, _opts?: any): AudioPlayer {
  let loop = false;
  return {
    play: () => {},
    remove: () => {},
    addListener: (_ev: string, cb: Listener) => {
      listeners.push(cb);
      return { remove: () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } };
    },
    set loop(v: boolean) { loop = v; },
    get loop() { return loop; },
    isLoaded: true,
  };
}
