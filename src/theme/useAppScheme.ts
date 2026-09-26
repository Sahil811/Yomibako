import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { loadConfig } from '../services/jpdb/config';

/** Pure, headlessly testable resolution — override wins, auto follows system. */
export function resolveAppScheme(
  override: 'auto' | 'light' | 'dark' | null | undefined,
  system: string | null | undefined,
): 'light' | 'dark' {
  if (override === 'light') return 'light';
  if (override === 'dark') return 'dark';
  return system === 'dark' ? 'dark' : 'light';
}

/**
 * Google-level theme resolution: respects Settings → Appearance → Theme
 * (auto / light / dark) instead of blindly following the OS.
 * Falls back to the system scheme until the stored config loads.
 */
export function useAppColorScheme(): 'light' | 'dark' {
  const system = useColorScheme() ?? 'light';
  const [override, setOverride] = useState<'auto' | 'light' | 'dark' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadConfig().then((cfg) => {
      if (!cancelled) setOverride(cfg.theme ?? 'auto');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return resolveAppScheme(override, system);
}
