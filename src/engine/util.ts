/**
 * CloakProxy engine utilities — pure TypeScript, zero dependencies.
 * Nothing in src/engine may import firebase/* or chrome.* (CI-enforced boundary).
 */

/** Shannon entropy in bits per character over the full string. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Redacted, UI-safe preview of a raw token. Never render raw secrets in HUD chrome. */
export function redactPreview(s: string): string {
  if (s.length <= 8) return "•".repeat(Math.max(4, s.length));
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

/** Levenshtein edit distance (case-sensitive, char-level). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[b.length];
}

/** Normalized similarity in [0,1] — 1 means identical. */
export function similarity(a: string, b: string): number {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  if (na === nb) return 1;
  const max = Math.max(na.length, nb.length);
  if (max === 0) return 1;
  return 1 - levenshtein(na, nb) / max;
}

/** Normalized token form used by the verdict reconciler: lowercase alphanumerics only. */
export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Deterministic seeded RNG (mulberry32) — used by property-based tests, never by the pipeline. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
