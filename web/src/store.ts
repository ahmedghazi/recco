// Local-first store. Everything lives in localStorage for this test build.

export type Media = 'movie' | 'tv'

export interface Title {
  key: string
  media?: Media
  tmdbId?: number
  imdbId?: string
  lbSlug?: string
  title: string
  year?: number
  poster?: string // TMDB poster_path
  link?: string // original link when unresolved
  resolved: boolean
}

export interface Reco {
  from: string // who sent / told me
  origin?: string // who told the sender (forwarding chain)
  note?: string
  at: string
  channel: string // fling, link, qr, file, told
}

export interface LibItem extends Title {
  status: 'to_watch' | 'watched'
  rating?: number
  addedAt: string
  source: string // search, paste, share-target, csv:letterboxd, csv:imdb, received…
  recos: Reco[]
  myNote?: string // my own line, sent along when I pass it on
}

export interface ListItem {
  key: string
  note?: string
}

export interface List {
  single?: boolean // one title sent on its own, not a saved list
  id: string
  name: string
  topN?: number
  items: ListItem[]
  createdAt: string
  from?: string // set when the list was received
}

export interface GatewayEvent {
  at: string
  gateway: string
  detail: string
  ok: boolean
}

export interface Friend {
  name: string
  since: string
}

interface State {
  me: { id: string; name: string }
  friends: Record<string, Friend>
  visible: 'network' | 'friends' // who can see me on the same Wi-Fi
  relayUrl: string
  library: Record<string, LibItem>
  lists: List[]
  tmdbToken: string
  log: GatewayEvent[]
}

const KEY = 'recco:v1'

function load(): State {
  try {
    // migrate data saved under the previous working name
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem('bicrave:v1')
    if (raw) {
      const s = { ...blank(), ...JSON.parse(raw) }
      if (!s.me.id) s.me.id = newId()
      return s
    }
  } catch {}
  return blank()
}

function newId() {
  const a = new Uint8Array(9)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

function blank(): State {
  return { me: { id: newId(), name: '' }, friends: {}, visible: 'network', relayUrl: '', library: {}, lists: [], tmdbToken: '', log: [] }
}

export const state: State = load()

const listeners = new Set<() => void>()
export function onChange(fn: () => void) {
  listeners.add(fn)
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {}
  listeners.forEach((fn) => fn())
}

export const now = () => new Date().toISOString()
export const uid = () => Math.random().toString(36).slice(2, 10)

export function titleKey(t: Partial<Title>): string {
  if (t.tmdbId && t.media) return `${t.media}:${t.tmdbId}`
  if (t.imdbId) return `imdb:${t.imdbId}`
  if (t.lbSlug) return `lb:${t.lbSlug}`
  return `t:${(t.title || '').toLowerCase().trim()}|${t.year ?? ''}`
}

/** Add or merge a title into the library. Recommendations stack, they never overwrite. */
export function addToLibrary(t: Omit<Title, 'key'> & { key?: string }, source: string, reco?: Reco): LibItem {
  const key = t.key || titleKey(t)
  // Also merge with an unresolved twin (same imdb id) once we know the TMDB id
  const twin = Object.values(state.library).find(
    (i) => i.key !== key && ((t.imdbId && i.imdbId === t.imdbId) || (t.lbSlug && i.lbSlug === t.lbSlug)),
  )
  const existing = state.library[key] || twin
  if (existing && twin && twin.key !== key) {
    delete state.library[twin.key]
    // rewrite list references
    state.lists.forEach((l) => l.items.forEach((li) => li.key === twin.key && (li.key = key)))
  }
  const item: LibItem = existing
    ? { ...existing, ...pickDefined(t), key, resolved: existing.resolved || t.resolved }
    : { ...t, key, status: 'to_watch', addedAt: now(), source, recos: [] }
  if (reco && !item.recos.some((r) => r.from === reco.from)) item.recos.push(reco)
  state.library[key] = item
  return item
}

function pickDefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as Partial<T>
}

export function logGateway(gateway: string, detail: string, ok = true) {
  state.log.unshift({ at: now(), gateway, detail, ok })
  state.log = state.log.slice(0, 40)
  save()
}

export function libraryList(): LibItem[] {
  return Object.values(state.library).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}
