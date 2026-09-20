import test from 'node:test';
import assert from 'node:assert/strict';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getItemAsync, setItemAsync, deleteItemAsync } from '../storage';

test('native path delegates to SecureStore', async () => {
  (Platform as any).OS = 'android';
  (SecureStore as any).__resetSecureStore();
  await setItemAsync('k1', 'v1');
  assert.equal(await getItemAsync('k1'), 'v1');
  await deleteItemAsync('k1');
  assert.equal(await getItemAsync('k1'), null);
});

test('web path uses localStorage with prefix', async () => {
  (Platform as any).OS = 'web';
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  await setItemAsync('wk', 'wv');
  assert.equal(await getItemAsync('wk'), 'wv');
  assert.equal(mem.get('yomibako:wk'), 'wv');
  await deleteItemAsync('wk');
  assert.equal(await getItemAsync('wk'), null);
  delete (globalThis as any).localStorage;
  (Platform as any).OS = 'android';
});

test('web fallback reads legacy unprefixed key', async () => {
  (Platform as any).OS = 'web';
  const mem = new Map<string, string>([['legacy', 'lv']]);
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
  };
  assert.equal(await getItemAsync('legacy'), 'lv');
  delete (globalThis as any).localStorage;
  (Platform as any).OS = 'android';
});

test('SecureStore failure falls back to localStorage', async () => {
  (Platform as any).OS = 'android';
  const orig = (SecureStore as any).getItemAsync;
  (SecureStore as any).getItemAsync = async () => { throw new Error('boom'); };
  const mem = new Map<string, string>([['yomibako:fk', 'fv']]);
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: () => {},
    removeItem: () => {},
  };
  assert.equal(await getItemAsync('fk'), 'fv');
  (SecureStore as any).getItemAsync = orig;
  delete (globalThis as any).localStorage;
});

test('throwing localStorage and SecureStore are swallowed', async () => {
  (Platform as any).OS = 'web';
  (globalThis as any).localStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.equal(await getItemAsync('x'), null);
  await setItemAsync('x', 'y'); // must not throw
  await deleteItemAsync('x');
  delete (globalThis as any).localStorage;
  assert.equal(await getItemAsync('x'), null, 'no localStorage at all');
  await setItemAsync('x', 'y');
  await deleteItemAsync('x');
  (Platform as any).OS = 'android';
  const oSet = (SecureStore as any).setItemAsync;
  const oDel = (SecureStore as any).deleteItemAsync;
  (SecureStore as any).setItemAsync = async () => { throw new Error('full'); };
  (SecureStore as any).deleteItemAsync = async () => { throw new Error('full'); };
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  await setItemAsync('a', 'b');
  await deleteItemAsync('a');
  (SecureStore as any).setItemAsync = oSet;
  (SecureStore as any).deleteItemAsync = oDel;
  delete (globalThis as any).localStorage;
});
