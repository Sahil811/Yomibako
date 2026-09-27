// Universal key-value storage — SecureStore on native, localStorage on web.
// Fixes: ExpoSecureStore.getValueWithKeyAsync is not a function (web).
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const PREFIX = 'yomibako:';

function webGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PREFIX + key) ?? localStorage.getItem(key);
  } catch {
    return null;
  }
}

function webSet(key: string, value: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PREFIX + key, value);
  } catch {}
}

function webDelete(key: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PREFIX + key);
    localStorage.removeItem(key);
  } catch {}
}

export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return webGet(key);
  try {
    const value = await SecureStore.getItemAsync(key);
    recordReadSuccess();
    return value;
  } catch {
    recordReadFailure();
    return webGet(key);
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  // Refuse to clobber a store that reads as corrupt (keystore-loss restore):
  // overwriting the consolidated index with defaults would wipe all progress.
  if (isStorageCorrupt()) {
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
    recordWriteSuccess();
  } catch {
    recordWriteFailure();
    webSet(key, value);
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    webDelete(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    webDelete(key);
  }
}

// Corrupt-store detector (F1): Android EncryptedSharedPreferences restored
// from backup with a rotated/lost Keystore key fails every read. Previously
// every position silently became 0 and the next flush overwrote good data.
// Now failures are counted and surfaced via getStorageHealth() for
// Settings → Diagnostics, and setItemAsync refuses to overwrite while corrupt.
let readFailures = 0;
let writeFailures = 0;
let corruptDetected = false;

function recordReadSuccess(): void {
  readFailures = 0;
  if (writeFailures === 0) corruptDetected = false;
}

function recordReadFailure(): void {
  readFailures += 1;
  // Two consecutive native read failures = keystore-loss signature, not a
  // transient blip. Mark corrupt so consolidated writes are held.
  if (readFailures >= 2) corruptDetected = true;
}

function recordWriteSuccess(): void {
  writeFailures = 0;
}

function recordWriteFailure(): void {
  writeFailures += 1;
}

export type StorageHealth = {
  status: 'unknown' | 'healthy' | 'corrupt';
  readFailures: number;
  writeFailures: number;
};

export function getStorageHealth(): StorageHealth {
  if (corruptDetected) return { status: 'corrupt', readFailures, writeFailures };
  if (readFailures === 0 && writeFailures === 0) return { status: 'unknown', readFailures, writeFailures };
  return { status: 'healthy', readFailures, writeFailures };
}

export function isStorageCorrupt(): boolean {
  return corruptDetected;
}

/** Test-only: clear health counters. */
export function __resetStorageForTests(): void {
  readFailures = 0;
  writeFailures = 0;
  corruptDetected = false;
}

/** Test-only: force corrupt flag (verify-before-overwrite tests). */
export function __setStorageCorruptForTests(v: boolean): void {
  corruptDetected = v;
}
