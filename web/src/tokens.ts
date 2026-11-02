// Read a number from theme.css (e.g. "1400ms", ".3s", "3"), so timings can be tuned there.
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
