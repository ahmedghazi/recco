/**
 * resolve.ts: turns anything people paste or share into a Title.
 *
 * Handles IMDb / Letterboxd / TMDB links, Spotify, Apple Podcasts, Deezer, YouTube, SoundCloud,
 * book and article links, share-sheet text blobs ("Watch Past Lives on…") and plain
 * "Title (2023)" lines. parseShared() works out what it is; resolve() looks films and series up
 * on TMDB and returns the best match plus alternatives.
 */
import { isTmdbMedia, mediaLabel, type Media, type Title, titleKey } from './store'
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
    const other = detectOther(url)
    if (other) return { kind: 'text', url, ...other, ...pick(fromText) }
    const host = new URL(url).hostname.replace(/^www\./, '')
    return { kind: 'text', source: host, media: 'other', url, guess: lastSlug(url), ...pick(fromText) }
  }
  if (fromText.guess) return { kind: 'text', source: 'text', ...fromText }
  return null
}

/** Last meaningful path segment of a URL, as words: ".../podcasts/la-serie-documentaire/les-loups-1234" → "Les Loups" */
function lastSlug(url: string): string | undefined {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean)
    for (let i = parts.length - 1; i >= 0; i--) {
      const seg = decodeURIComponent(parts[i]).replace(/\.[a-z]{2,4}$/i, '').replace(/[-_]\d{4,}$/, '').replace(/^\d+[.\-_]?/, '')
      if (seg.length > 2 && !/^(id\d+|\d+|[a-z]{2}|show|track|album|episode|podcast|podcasts|watch)$/i.test(seg))
        return seg.replace(/[-_+]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }
  } catch {}
  return undefined
}

/** Music, podcasts, videos, books: recognised by where the link points. */
function detectOther(url: string): { source: string; media: Media; guess?: string } | null {
  const u = url.toLowerCase()
  const g = lastSlug(url)
  let m: RegExpMatchArray | null
  if ((m = u.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|artist|playlist|episode|show)\//)))
    return { source: 'Spotify', media: m[1] === 'episode' || m[1] === 'show' ? 'podcast' : 'music' }
  if (u.includes('podcasts.apple.com')) return { source: 'Apple Podcasts', media: 'podcast', guess: g }
  if (u.includes('music.apple.com')) return { source: 'Apple Music', media: 'music', guess: g }
  if ((m = u.match(/deezer\.com\/(?:[a-z]{2}\/)?(track|album|artist|playlist|show|episode)\//)))
    return { source: 'Deezer', media: m[1] === 'show' || m[1] === 'episode' ? 'podcast' : 'music' }
  if (u.includes('soundcloud.com')) return { source: 'SoundCloud', media: 'music', guess: g }
  if (u.includes('.bandcamp.com')) return { source: 'Bandcamp', media: 'music', guess: g }
  if (u.includes('music.youtube.com')) return { source: 'YouTube Music', media: 'music' }
  if (/(youtube\.com\/(watch|shorts|live)|youtu\.be\/)/.test(u)) return { source: 'YouTube', media: 'video' }
  if (u.includes('vimeo.com')) return { source: 'Vimeo', media: 'video' }
  if (u.includes('radiofrance.fr') || u.includes('arteradio.com') || u.includes('podcast'))
    return { source: u.includes('radiofrance') ? 'Radio France' : 'Podcast', media: 'podcast', guess: g }
  if (u.includes('goodreads.com') || u.includes('babelio.com')) return { source: u.includes('goodreads') ? 'Goodreads' : 'Babelio', media: 'book', guess: g }
  return null
}

function pick(o: { guess?: string; year?: number }) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as typeof o
}

/** Resolve to TMDB when a token is set; otherwise keep an unresolved title that still works. */
export async function resolve(p: Parsed): Promise<{ title: Title; candidates: Title[] }> {
  const fallback = (): Title => {
    const t = {
      title: p.guess || p.slug || `${p.source} ${mediaLabel(p.media).toLowerCase()}`,
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
  // films and series go through TMDB; music, podcasts, videos… keep what the link told us
  if (!hasTmdb() || (p.media && !isTmdbMedia(p.media))) return { title: fallback(), candidates: [] }

  try {
    if (p.kind === 'tmdb' && isTmdbMedia(p.media) && p.tmdbId) return { title: await details(p.media, p.tmdbId), candidates: [] }
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
