// In-memory SecureStore for Node tests.
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/** Test-only reset. */
export function __resetSecureStore() {
  store.clear();
}

/** Test-only direct seed. */
export function __seedSecureStore(entries: Record<string, string>) {
  for (const [k, v] of Object.entries(entries)) store.set(k, v);
}
