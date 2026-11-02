// IMDb, Rotten Tomatoes and Metacritic scores, via OMDb (free key: omdbapi.com/apikey.aspx).
import { state, type Rating } from './store'

const key = () => (state.omdbKey || (import.meta.env.VITE_OMDB_KEY as string | undefined) || '').trim()
export const hasOmdb = () => key().length > 0

export async function omdbRatings(imdbId: string): Promise<Rating[]> {
  const r = await fetch(`https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(key())}`)
  const j = await r.json()
  if (j.Response === 'False') return []
  const out: Rating[] = []
  const num = (s?: string) => (s && s !== 'N/A' ? Number(String(s).replace(/[^\d.]/g, '')) : NaN)
  const imdb = num(j.imdbRating)
  if (!isNaN(imdb))
    out.push({ source: 'IMDb', value: imdb.toFixed(1), outOf10: imdb, votes: num(j.imdbVotes) || undefined, url: `https://www.imdb.com/title/${imdbId}/` })
  for (const x of j.Ratings || []) {
    if (x.Source === 'Rotten Tomatoes') {
      const v = num(x.Value)
      if (!isNaN(v)) out.push({ source: 'Rotten Tomatoes', value: `${v}%`, outOf10: v / 10, url: `https://www.rottentomatoes.com/search?search=${encodeURIComponent(j.Title || '')}` })
    }
    if (x.Source === 'Metacritic') {
      const v = num(x.Value.split('/')[0])
      if (!isNaN(v)) out.push({ source: 'Metacritic', value: String(v), outOf10: v / 10, url: `https://www.metacritic.com/search/${encodeURIComponent(j.Title || '')}/` })
    }
  }
  return out
}

/** Average of every available score, on 10. */
export function globalScore(ratings?: Rating[]): number | null {
  const r = (ratings || []).filter((x) => x.outOf10 > 0)
  if (!r.length) return null
  return Math.round((r.reduce((s, x) => s + x.outOf10, 0) / r.length) * 10) / 10
}
