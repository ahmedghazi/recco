import { state, type TmdbMedia as Media, type Title, titleKey } from './store'

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
