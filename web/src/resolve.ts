// Turn anything people share (a link, a share-sheet text blob, a CSV row) into a Title.
import { type Media, type Title, titleKey } from './store'
import { details, findImdb, hasTmdb, search } from './tmdb'

export interface Parsed {
  kind: 'imdb' | 'tmdb' | 'letterboxd' | 'boxd' | 'slug' | 'text'
  source: string // human label: IMDb, Letterboxd…
  imdbId?: string
  tmdbId?: number
  media?: Media
  slug?: string
  guess?: string // title guessed from slug or text
  year?: number
  url?: string
}

const URL_RE = /https?:\/\/[^\s<>"']+/i

export function extractUrl(text: string): string | undefined {
  return text.match(URL_RE)?.[0]
}

function slugToTitle(slug: string): { guess: string; year?: number } {
  const m = slug.match(/^(.*?)-(\d{4})$/)
  const base = m ? m[1] : slug
  return { guess: base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), year: m ? Number(m[2]) : undefined }
}

/** "Past Lives (2023)" style title + year from share-sheet text */
function titleFromText(text: string): { guess?: string; year?: number } {
  const clean = text.replace(URL_RE, '').trim()
  const m = clean.match(/(.+?)\s*\((\d{4})\)/)
  if (m) return { guess: m[1].replace(/^(watch|regarde|check out)\s+/i, '').trim(), year: Number(m[2]) }
  const firstLine = clean.split('\n')[0]?.trim()
  return firstLine && firstLine.length < 80 ? { guess: firstLine } : {}
}

export function parseShared(input: { url?: string; text?: string; title?: string }): Parsed | null {
  const text = [input.title, input.text].filter(Boolean).join('\n')
  const url = input.url || extractUrl(text)
  const fromText = titleFromText(text)

  if (url) {
    let m: RegExpMatchArray | null
    if ((m = url.match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d+)/i)))
      return { kind: 'imdb', source: 'IMDb', imdbId: m[1], url, ...fromText }
    if ((m = url.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i)))
      return { kind: 'tmdb', source: 'TMDB', media: m[1] as Media, tmdbId: Number(m[2]), url }
    if ((m = url.match(/letterboxd\.com\/(?:[^/]+\/)?film\/([a-z0-9-]+)/i)))
      return { kind: 'letterboxd', source: 'Letterboxd', slug: m[1], url, ...slugToTitle(m[1]), ...pick(fromText) }
    if (/boxd\.it\//i.test(url)) return { kind: 'boxd', source: 'Letterboxd', url, ...fromText }
    if ((m = url.match(/trakt\.tv\/(movies|shows)\/([a-z0-9-]+)/i)))
      return { kind: 'slug', source: 'Trakt', media: m[1] === 'shows' ? 'tv' : 'movie', slug: m[2], url, ...slugToTitle(m[2]) }
    if ((m = url.match(/senscritique\.com\/(film|serie)\/([^/]+)/i)))
      return { kind: 'slug', source: 'SensCritique', media: m[1] === 'serie' ? 'tv' : 'movie', slug: m[2], url, ...slugToTitle(m[2].toLowerCase()) }
    if ((m = url.match(/justwatch\.com\/[a-z]{2}\/(film|serie|movie|tv-show|tv-series)\/([a-z0-9-]+)/i)))
      return { kind: 'slug', source: 'JustWatch', slug: m[2], url, ...slugToTitle(m[2]) }
    if ((m = url.match(/allocine\.fr\/(film|series)\//i)))
      return { kind: 'text', source: 'Allociné', url, ...fromText }
    return { kind: 'text', source: new URL(url).hostname.replace(/^www\./, ''), url, ...fromText }
  }
  if (fromText.guess) return { kind: 'text', source: 'text', ...fromText }
  return null
}

function pick(o: { guess?: string; year?: number }) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as typeof o
}

/** Resolve to TMDB when a token is set; otherwise keep an unresolved title that still works. */
export async function resolve(p: Parsed): Promise<{ title: Title; candidates: Title[] }> {
  const fallback = (): Title => {
    const t = {
      title: p.guess || p.slug || p.url || 'Untitled',
      year: p.year,
      imdbId: p.imdbId,
      lbSlug: p.kind === 'letterboxd' ? p.slug : undefined,
      media: p.media,
      tmdbId: p.tmdbId,
      link: p.url,
      resolved: false,
    }
    return { ...t, key: titleKey(t) }
  }
  if (!hasTmdb()) return { title: fallback(), candidates: [] }

  try {
    if (p.kind === 'tmdb' && p.media && p.tmdbId) return { title: await details(p.media, p.tmdbId), candidates: [] }
    if (p.kind === 'imdb' && p.imdbId) {
      const t = await findImdb(p.imdbId)
      if (t) return { title: t, candidates: [] }
    }
    if (p.guess) {
      let results = await search(p.guess, p.year)
      if (p.media) results = [...results.filter((r) => r.media === p.media), ...results.filter((r) => r.media !== p.media)]
      if (results.length) {
        const best = { ...results[0], lbSlug: p.kind === 'letterboxd' ? p.slug : undefined, imdbId: p.imdbId }
        return { title: best, candidates: results.slice(1, 6) }
      }
    }
  } catch (e) {
    console.warn(e)
  }
  return { title: fallback(), candidates: [] }
}
