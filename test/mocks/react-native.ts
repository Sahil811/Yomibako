// Node test double for react-native (Platform only — UI not loaded in tests).
export const Platform: { OS: string; select: <T>(o: any) => T } = {
  OS: 'android',
  select: (o: any) => (o?.android ?? o?.default ?? o?.ios ?? o?.native ?? undefined) as any,
};
