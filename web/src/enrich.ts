// Title page extras: TMDB details for films/series, players + artwork for everything else.
import { isTmdbMedia, save, type LibItem } from './store'
import { fullDetails, hasTmdb } from './tmdb'
import { hasOmdb, omdbRatings } from './omdb'

const STALE_MS = 1000 * 60 * 60 * 24 * 14 // refetch after two weeks

/** Fetch and store details once. Resolves true when something new was added. */
export async function enrich(i: LibItem): Promise<boolean> {
  const film = !!i.tmdbId && isTmdbMedia(i.media) && hasTmdb()
  const fresh = i.details && Date.now() - Date.parse(i.details.fetchedAt) < STALE_MS
  // films fetched before ratings existed (v < 2) get refetched once
  if (fresh && (!film || i.details!.v === 2)) {
    // ratings can still be added later, once an OMDb key is set
    if (film && hasOmdb() && i.imdbId && !i.details!.ratings?.some((r) => r.source === 'IMDb')) return addOmdb(i)
    return false
  }
  try {
    if (film) {
      const { imdbId, ...d } = await fullDetails(i.media as 'movie' | 'tv', i.tmdbId!)
      i.details = d
      if (imdbId && !i.imdbId) i.imdbId = imdbId
      save()
      if (hasOmdb() && i.imdbId) await addOmdb(i)
      return true
    }
    if (i.link) {
      const o = await oembed(i.link)
      i.details = { author: o?.author, fetchedAt: new Date().toISOString() }
      if (o?.thumbnail && !i.image) i.image = o.thumbnail
      // replace placeholder titles like "Spotify music" with the real one
      if (o?.title && (!i.resolved || /^(Spotify|Deezer|YouTube|YouTube Music|Vimeo|SoundCloud|Bandcamp|Apple Music|Apple Podcasts|Podcast) \w+$/.test(i.title))) {
        i.title = o.title
      }
      save()
      return !!o
    }
  } catch (e) {
    console.warn('enrich', e)
  }
  return false
}

async function addOmdb(i: LibItem): Promise<boolean> {
  try {
    const extra = await omdbRatings(i.imdbId!)
    if (!extra.length || !i.details) return false
    i.details.ratings = [...(i.details.ratings || []).filter((r) => r.source === 'TMDB'), ...extra]
    save()
    return true
  } catch {
    return false
  }
}

/** Title, author and thumbnail for most media links (noembed proxies oEmbed with CORS). */
async function oembed(url: string): Promise<{ title?: string; author?: string; thumbnail?: string } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, { signal: ctrl.signal })
    const j = await r.json()
    if (j.error) return null
    return { title: j.title, author: j.author_name, thumbnail: j.thumbnail_url }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export interface Player {
  kind: 'youtube' | 'iframe'
  src: string // iframe src, or YouTube video key
  height?: number
}

/** An embeddable player for the link, when the service allows it. */
export function playerFor(link?: string): Player | null {
  if (!link) return null
  let m: RegExpMatchArray | null
  try {
    const u = new URL(link)
    const h = u.hostname.replace(/^www\./, '')
    if (h === 'youtu.be') return { kind: 'youtube', src: u.pathname.slice(1) }
    if (h.endsWith('youtube.com')) {
      const v = u.searchParams.get('v') || (u.pathname.match(/\/(?:shorts|live|embed)\/([\w-]+)/) || [])[1]
      if (v) return { kind: 'youtube', src: v }
    }
    if ((m = u.pathname.match(/^\/(?:intl-[a-z]+\/)?(track|album|artist|playlist|episode|show)\/(\w+)/)) && h === 'open.spotify.com')
      return { kind: 'iframe', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 }
    if ((m = u.pathname.match(/\/(track|album|playlist|show|episode|artist)\/(\d+)/)) && h.endsWith('deezer.com'))
      return { kind: 'iframe', src: `https://widget.deezer.com/widget/auto/${m[1]}/${m[2]}`, height: m[1] === 'track' || m[1] === 'episode' ? 150 : 300 }
    if (h === 'music.apple.com') return { kind: 'iframe', src: `https://embed.music.apple.com${u.pathname}${u.search}`, height: u.searchParams.has('i') ? 175 : 450 }
    if (h === 'podcasts.apple.com') return { kind: 'iframe', src: `https://embed.podcasts.apple.com${u.pathname}${u.search}`, height: u.searchParams.has('i') ? 175 : 450 }
    if (h === 'soundcloud.com') return { kind: 'iframe', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(link)}&color=%23333333&visual=false`, height: 166 }
    if (h === 'vimeo.com' && (m = u.pathname.match(/^\/(\d+)/))) return { kind: 'iframe', src: `https://player.vimeo.com/video/${m[1]}`, height: 0 }
  } catch {}
  return null
}
