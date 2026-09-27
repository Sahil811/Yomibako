// Node test double for react-native (Platform + useColorScheme — UI is not
// loaded in tests, but theme helpers are compiled by tsconfig.test.json).
export const Platform: { OS: string; select: <T>(o: any) => T } = {
  OS: 'android',
  select: (o: any) => (o?.android ?? o?.default ?? o?.ios ?? o?.native ?? undefined) as any,
};

/** Fixed scheme: nothing renders UI here, so the "system" value is a constant. */
export function useColorScheme(): 'light' | 'dark' | null {
  return 'dark';
}

export const AppState: {
  addEventListener: (type: string, cb: (state: string) => void) => { remove: () => void };
  currentState: string;
} = {
  currentState: 'active',
  addEventListener: () => ({ remove: () => {} }),
};
