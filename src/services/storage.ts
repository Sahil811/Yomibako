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
    return await SecureStore.getItemAsync(key);
  } catch {
    return webGet(key);
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSet(key, value);
    return;
  }
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
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
