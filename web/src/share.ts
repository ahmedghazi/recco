// Share payloads travel inside the link itself (no backend needed for the test).
import QRCode from 'qrcode'
import { state, type List, type Media } from './store'

export interface PayloadItem {
  t: string // title
  y?: number
  m?: Media
  i?: number // tmdb id
  im?: string // imdb id
  p?: string // poster path
  g?: string // artwork URL (non-TMDB)
  l?: string // original link (music, podcasts, videos…)
  n?: string // note
  o?: string // origin: who told the sender
  s?: string // score shown on the card, e.g. "IMDb 7.8"
}

export interface Payload {
  v: 1
  from: string
  fid?: string // sender device id → becomes a friend on keep
  list: { name: string; topN?: number; single?: boolean }
  items: PayloadItem[]
}

export function buildPayload(list: List): Payload {
  return {
    v: 1,
    from: state.me.name || 'A friend',
    fid: state.me.id,
    list: { name: list.name, topN: list.topN, single: list.single || undefined },
    items: list.items
      .map((li) => {
        const t = state.library[li.key]
        if (!t) return null
        const origin = t.recos.find((r) => r.from !== state.me.name)?.from
        const rr = t.details?.ratings || []
        const sc = rr.find((x) => x.source === 'IMDb') || rr.find((x) => x.source === 'TMDB')
        const it: PayloadItem = { t: t.title, y: t.year, m: t.media, i: t.tmdbId, im: t.imdbId, p: t.poster, g: t.image, l: t.tmdbId ? undefined : t.link, n: li.note, o: origin, s: sc ? `${sc.source} ${sc.value}` : undefined }
        return Object.fromEntries(Object.entries(it).filter(([, v]) => v !== undefined && v !== '')) as PayloadItem
      })
      .filter(Boolean) as PayloadItem[],
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function encode(p: Payload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(p))
  if ('CompressionStream' in window) return 'z' + b64url(await pipe(json, new CompressionStream('deflate-raw')))
  return 'j' + b64url(json)
}

export async function decode(s: string): Promise<Payload> {
  const bytes = fromB64url(s.slice(1))
  const json = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes
  const p = JSON.parse(new TextDecoder().decode(json))
  if (p.v !== 1 || !Array.isArray(p.items)) throw new Error('Not a Recco payload')
  return p
}

export function appBase(): string {
  return location.origin + location.pathname.replace(/index\.html$/, '')
}

export async function shareUrl(list: List, channel: string): Promise<string> {
  return `${appBase()}#/r/${channel}/${await encode(buildPayload(list))}`
}

export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 640, color: { dark: '#141210', light: '#f4efe6' } })
}

export function payloadFile(p: Payload): File {
  const name = p.list.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() || 'list'
  return new File([JSON.stringify(p, null, 2)], `${name}.recco.json`, { type: 'application/json' })
}

export const support = {
  share: () => typeof navigator.share === 'function',
  shareFiles: () => {
    try {
      return !!navigator.canShare?.({ files: [new File(['{}'], 't.json', { type: 'application/json' })] })
    } catch {
      return false
    }
  },
  clipboardRead: () => !!navigator.clipboard?.readText,
  compression: () => 'CompressionStream' in window,
  standalone: () =>
    matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true,
  sw: () => !!navigator.serviceWorker?.controller,
  ios: () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  android: () => /Android/i.test(navigator.userAgent),
}
