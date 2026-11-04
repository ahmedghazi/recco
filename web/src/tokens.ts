/**
 * tokens.ts: lets the JS read design tokens from styles/_tokens.scss.
 *
 * token('--arrive-duration', 1400) returns a number: "1400ms" → 1400, ".3s" → 300, "22" → 22.
 * So timings and thresholds (hold delay, trail lag, poke threshold…) are tuned in CSS, in one place.
 */
export function token(name: string, fallback: number): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!raw) return fallback
    const n = parseFloat(raw)
    if (isNaN(n)) return fallback
    return /ms$/.test(raw) ? n : /s$/.test(raw) ? n * 1000 : n
  } catch {
    return fallback
  }
}
