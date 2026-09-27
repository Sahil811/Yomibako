// Perf budget harness — F0 of Final Vetted Plan.
//
// Single ring-buffer for cold-start / volume-open timings. No RN/Expo deps
// so it compiles into .test-out (tsconfig.test.json only includes .ts) and
// costs ~0 when disabled: performance.now() + array push only, no
// JSON.stringify on the hot path. Flush to disk is the caller's job.
export type BudgetEntry = {
  label: string;
  ms: number;
  count?: number;
  extra?: string;
};

const MAX_ENTRIES = 200;
let entries: BudgetEntry[] = [];
let enabled = true;

function now(): number {
  try {
    const p = (globalThis as { performance?: { now?: () => number } }).performance;
    if (p?.now) return p.now();
  } catch {}
  return Date.now();
}

/** Turn recording on/off (tests, low-end devices). */
export function setBudgetEnabled(v: boolean): void {
  enabled = v;
  if (!v) entries = [];
}

export function isBudgetEnabled(): boolean {
  return enabled;
}

/** Record a finished span. Evicts oldest when full (ring buffer). */
export function mark(label: string, ms: number, count?: number, extra?: string): void {
  if (!enabled) return;
  if (!Number.isFinite(ms)) return;
  const entry: BudgetEntry = { label, ms };
  if (typeof count === 'number') entry.count = count;
  if (typeof extra === 'string') entry.extra = extra.slice(0, 160);
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** Time a sync fn and record it. Returns fn's return value. */
export function span<T>(label: string, fn: () => T): T {
  if (!enabled) return fn();
  const t0 = now();
  try {
    return fn();
  } finally {
    mark(label, now() - t0);
  }
}

/** Time an async fn and record it. Returns fn's promise. */
export async function spanAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const t0 = now();
  try {
    return await fn();
  } finally {
    mark(label, now() - t0);
  }
}

/** Snapshot in flush order (oldest first). Copy — mutating it is safe. */
export function getBudgetEntries(): BudgetEntry[] {
  return entries.map((e) => ({ ...e }));
}

/** Aggregate by label: total ms + call count. For Diagnostics rendering. */
export function summarizeBudget(): Record<string, { totalMs: number; calls: number }> {
  const out: Record<string, { totalMs: number; calls: number }> = {};
  for (const e of entries) {
    const agg = out[e.label] ?? { totalMs: 0, calls: 0 };
    agg.totalMs += e.ms;
    agg.calls += 1;
    out[e.label] = agg;
  }
  return out;
}

export function clearBudget(): void {
  entries = [];
}

/** Test-only: reset buffer + re-enable. */
export function __resetBudgetForTests(): void {
  entries = [];
  enabled = true;
}

export const BUDGET_MAX = MAX_ENTRIES;
