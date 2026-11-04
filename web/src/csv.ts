/**
 * csv.ts: import from Letterboxd and IMDb exports (Collect → Import CSV).
 *
 * parseCsv() is a small quote-aware parser; detectAndMap() recognises which service the file came
 * from and maps its columns to rows (title, year, imdb id, Letterboxd slug, rating…) for resolve.ts.
 */
export interface CsvRow {
  title: string
  year?: number
  imdbId?: string
  lbUri?: string
  rating?: number
  watched?: boolean
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') q = false
      else field += c
    } else if (c === '"') q = true
    else if (c === ',') row.push(field), (field = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field), rows.push(row), (row = []), (field = '')
    } else field += c
  }
  if (field || row.length) row.push(field), rows.push(row)
  return rows.filter((r) => r.some((f) => f.trim()))
}

export function detectAndMap(text: string): { source: 'letterboxd' | 'imdb' | 'unknown'; rows: CsvRow[] } {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ''))
  if (!header) return { source: 'unknown', rows: [] }
  const h = header.map((x) => x.trim().toLowerCase())
  const col = (name: string) => h.indexOf(name)

  if (col('letterboxd uri') >= 0 && col('name') >= 0) {
    const n = col('name'), y = col('year'), u = col('letterboxd uri'), r = col('rating')
    return {
      source: 'letterboxd',
      rows: body.map((row) => ({
        title: row[n],
        year: Number(row[y]) || undefined,
        lbUri: row[u],
        rating: r >= 0 && row[r] ? Math.round(Number(row[r]) * 2) : undefined, // 0.5–5 stars → 1–10
        watched: r >= 0 && !!row[r],
      })),
    }
  }
  if (col('const') >= 0 && col('title') >= 0) {
    const c = col('const'), t = col('title'), y = col('year'), r = col('your rating')
    return {
      source: 'imdb',
      rows: body.map((row) => ({
        title: row[t],
        year: Number(row[y]) || undefined,
        imdbId: row[c],
        rating: r >= 0 && row[r] ? Number(row[r]) : undefined,
        watched: r >= 0 && !!row[r],
      })),
    }
  }
  return { source: 'unknown', rows: [] }
}
