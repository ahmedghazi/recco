// Client side of the relay: presence ("around") + sending hands to someone nearby.
import { state, save } from './store'
import type { Payload } from './share'

export interface Peer {
  id: string
  name: string
  friend: boolean
  how: 'network' | 'online' | 'code'
}

export interface IncomingHand {
  from: { id: string; name: string }
  friend: boolean
  payload: Payload
  ref: string
}

type Listener<T> = (v: T) => void

const env = import.meta.env as any
function relayUrl(): string {
  const raw = (state.relayUrl || env.VITE_RELAY_URL || '').trim()
  // dev default: relay on the same host, port 8787
  if (!raw) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787`
  return normalizeWs(raw)
}

/** Accept "recco-relay.fly.dev", "https://…", "ss://…" and the like. */
function normalizeWs(url: string): string {
  if (/^wss?:\/\//i.test(url)) return url
  if (/^http:\/\//i.test(url)) return url.replace(/^http/i, 'ws')
  const host = url.replace(/^[a-z]*:?\/\//i, '')
  return `wss://${host}`
}

let ws: WebSocket | null = null
let retry = 0
let peers: Peer[] = []
let status: 'off' | 'connecting' | 'on' = 'off'
let net = '' // short network id from the relay, for debugging "can't see each other"
const peerListeners = new Set<Listener<Peer[]>>()
const handListeners = new Set<Listener<IncomingHand>>()
const ackListeners = new Set<Listener<{ from: { id: string; name: string }; kept: boolean }>>()
const pendingSends = new Map<string, (ok: boolean) => void>()

export const relay = {
  get peers() { return peers },
  get status() { return status },
  get net() { return net },
  onPeers(fn: Listener<Peer[]>) { peerListeners.add(fn); fn(peers); return () => peerListeners.delete(fn) },
  onHand(fn: Listener<IncomingHand>) { handListeners.add(fn) },
  onAck(fn: Listener<{ from: { id: string; name: string }; kept: boolean }>) { ackListeners.add(fn) },

  connect() {
    if (ws && ws.readyState <= 1) return
    status = 'connecting'
    try {
      ws = new WebSocket(relayUrl())
    } catch {
      return scheduleReconnect()
    }
    ws.onopen = () => {
      retry = 0
      status = 'on'
      hello()
    }
    ws.onmessage = (e) => {
      let m: any
      try { m = JSON.parse(e.data) } catch { return }
      if (m.t === 'around') {
        peers = m.peers
        // a peer flagged as friend by the other side becomes our friend too
        peerListeners.forEach((fn) => fn(peers))
      }
      if (m.t === 'welcome') net = String(m.net || '')
      if (m.t === 'hand') handListeners.forEach((fn) => fn(m))
      if (m.t === 'ack') ackListeners.forEach((fn) => fn(m))
      if (m.t === 'delivered' || m.t === 'undelivered') {
        pendingSends.get(m.ref)?.(m.t === 'delivered')
        pendingSends.delete(m.ref)
      }
    }
    ws.onclose = () => {
      status = 'off'
      peers = []
      peerListeners.forEach((fn) => fn(peers))
      scheduleReconnect()
    }
    ws.onerror = () => ws?.close()
  },

  update() {
    if (ws?.readyState === 1)
      ws.send(JSON.stringify({ t: 'update', name: state.me.name, friends: Object.keys(state.friends), visible: state.visible }))
  },

  setCode(code: string | null) {
    ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'code', code }))
  },

  send(to: string, payload: Payload): Promise<boolean> {
    const ref = Math.random().toString(36).slice(2)
    return new Promise((resolve) => {
      if (ws?.readyState !== 1) return resolve(false)
      pendingSends.set(ref, resolve)
      ws.send(JSON.stringify({ t: 'send', to, payload, ref }))
      setTimeout(() => pendingSends.has(ref) && (pendingSends.delete(ref), resolve(false)), 5000)
    })
  },

  ack(to: string, ref: string, kept: boolean) {
    ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'ack', to, ref, kept }))
  },
}

function hello() {
  ws?.send(JSON.stringify({ t: 'hello', id: state.me.id, name: state.me.name, friends: Object.keys(state.friends), visible: state.visible }))
}

function scheduleReconnect() {
  const delay = Math.min(15000, 500 * 2 ** retry++)
  setTimeout(() => relay.connect(), delay)
}

// Reconnect immediately when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') relay.connect()
})

export function addFriend(id: string, name: string) {
  if (!id || id === state.me.id) return
  const known = state.friends[id]
  state.friends[id] = { name, since: known?.since || new Date().toISOString() }
  save()
  relay.update()
}
