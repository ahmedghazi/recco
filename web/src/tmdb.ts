/**
 * tmdb.ts: The Movie Database API (films and series).
 *
 * Token: Settings (per device), else VITE_TMDB_TOKEN baked into the build (it is public in the
 * bundle by design, read-only key). search(), findImdb() (IMDb id → title), details(),
 * fullDetails() (one call with videos, images, credits, providers, external ids), poster().
 */
import { state, type Details, type TmdbMedia as Media, type Title, titleKey } from './store'

const API = 'https://api.themoviedb.org/3'
export const IMG = 'https://image.tmdb.org/t/p/'

// Token from Gateways → Settings (per device), else VITE_TMDB_TOKEN from web/.env (baked into the build)
const token = () => (state.tmdbToken || (import.meta.env.VITE_TMDB_TOKEN as string | undefined) || '').trim()
export const hasTmdb = () => token().length > 0

async function get(path: string, params: Record<string, string> = {}) {
  const token_ = token()
  const q = new URLSearchParams({ language: 'fr-FR', ...params })
  const headers: Record<string, string> = { accept: 'application/json' }
  // v4 read access token (long JWT) → Bearer; v3 API key (32 hex) → query param
  if (token_.length > 40) headers.authorization = `Bearer ${token_}`
  else q.set('api_key', token_)
  const res = await fetch(`${API}${path}?${q}`, { headers })
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

function toTitle(r: any, media?: Media): Title {
  const m: Media = media || r.media_type
  const date: string = r.release_date || r.first_air_date || ''
  const t: Omit<Title, 'key'> = {
    media: m,
    tmdbId: r.id,
    title: r.title || r.name || r.original_title || r.original_name,
    year: date ? Number(date.slice(0, 4)) : undefined,
    poster: r.poster_path || undefined,
    resolved: true,
  }
  return { ...t, key: titleKey(t) }
}

export async function search(query: string, year?: number): Promise<Title[]> {
  const data = await get('/search/multi', { query, include_adult: 'false' })
  let results: Title[] = (data.results || [])
    .filter((r: any) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r: any) => toTitle(r))
  if (year) {
    const exact = results.filter((r) => r.year === year)
    if (exact.length) results = [...exact, ...results.filter((r) => r.year !== year)]
  }
  return results
}

export async function findImdb(imdbId: string): Promise<Title | null> {
  const data = await get(`/find/${imdbId}`, { external_source: 'imdb_id' })
  const m = data.movie_results?.[0]
  if (m) return { ...toTitle(m, 'movie'), imdbId }
  const tv = data.tv_results?.[0]
  if (tv) return { ...toTitle(tv, 'tv'), imdbId }
  return null
}

export async function details(media: Media, id: number): Promise<Title> {
  return toTitle(await get(`/${media}/${id}`), media)
}

export const poster = (path?: string, size = 'w342') => (path ? `${IMG}${size}${path}` : '')

/** Everything the title page shows: synopsis, people, trailer, images, where to watch (France). */
export async function fullDetails(media: Media, id: number): Promise<Details & { imdbId?: string }> {
  const d = await get(`/${media}/${id}`, {
    append_to_response: 'videos,images,credits,watch/providers,external_ids',
    include_image_language: 'fr,en,null',
    include_video_language: 'fr,en,null',
  })
  let overview: string = d.overview || ''
  if (!overview) overview = (await get(`/${media}/${id}`, { language: 'en-US' }).catch(() => ({}))).overview || ''
  const vids = (d.videos?.results || []).filter((v: any) => v.site === 'YouTube')
  const pickVid = (type: string, lang?: string) => vids.find((v: any) => v.type === type && (!lang || v.iso_639_1 === lang))
  const trailer = (pickVid('Trailer', 'fr') || pickVid('Trailer', 'en') || pickVid('Trailer') || pickVid('Teaser') || vids[0])?.key
  const crew = d.credits?.crew || []
  const director = media === 'movie'
    ? crew.filter((c: any) => c.job === 'Director').map((c: any) => c.name).join(', ')
    : (d.created_by || []).map((c: any) => c.name).join(', ')
  const fr = d['watch/providers']?.results?.FR
  const providers = [...(fr?.flatrate || []), ...(fr?.free || []), ...(fr?.ads || [])]
    .filter((p: any, i: number, a: any[]) => a.findIndex((x) => x.provider_id === p.provider_id) === i)
    .slice(0, 6)
    .map((p: any) => ({ name: p.provider_name, logo: p.logo_path }))
  return {
    overview: overview || undefined,
    tagline: d.tagline || undefined,
    director: director || undefined,
    cast: (d.credits?.cast || []).slice(0, 6).map((c: any) => c.name),
    runtime: d.runtime || d.episode_run_time?.[0] || undefined,
    seasons: d.number_of_seasons || undefined,
    genres: (d.genres || []).map((g: any) => g.name),
    backdrops: (d.images?.backdrops || []).slice(0, 10).map((b: any) => b.file_path),
    trailer,
    providers,
    watchLink: fr?.link,
    imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined,
    ratings: d.vote_count
      ? [{ source: 'TMDB', value: (Math.round(d.vote_average * 10) / 10).toFixed(1), outOf10: d.vote_average, votes: d.vote_count, url: `https://www.themoviedb.org/${media}/${id}` }]
      : [],
    v: 2,
    fetchedAt: new Date().toISOString(),
  }
}
