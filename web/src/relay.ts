/**
 * relay.ts: client side of the relay (server/relay.mjs), over one WebSocket.
 *
 * - presence: who's "around" (same network, friends online anywhere, same 4-letter code)
 * - send(): push a payload to someone; resolves true once their app confirms delivery
 * - acks: "Tom kept it" notices; poke(): report a phone knock (see poke.ts)
 *
 * Relay URL: Settings value, else VITE_RELAY_URL, else wss://recco-relay.fly.dev when deployed,
 * ws://<host>:8787 locally. Typos like "ss://" are normalised.
 * Reconnects with jittered backoff; the people list survives short drops so "around" doesn't blink.
 * addFriend() stores someone met via poke / code so you see each other anywhere afterwards.
 */
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
  if (!raw) {
    // local dev (localhost or a LAN address): relay on the same host, port 8787
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(location.hostname)
    // deployed without VITE_RELAY_URL: use the public relay
    return local ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:8787` : 'wss://recco-relay.fly.dev'
  }
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
const pokeListeners = new Set<Listener<{ id: string; name: string }>>()
const pendingSends = new Map<string, (ok: boolean) => void>()

export const relay = {
  get peers() { return peers },
  get status() { return status },
  get net() { return net },
  onPeers(fn: Listener<Peer[]>) { peerListeners.add(fn); fn(peers); return () => peerListeners.delete(fn) },
  onHand(fn: Listener<IncomingHand>) { handListeners.add(fn) },
  onAck(fn: Listener<{ from: { id: string; name: string }; kept: boolean }>) { ackListeners.add(fn) },
  /** someone touched phones with us at the same instant */
  onPokeMatch(fn: Listener<{ id: string; name: string }>) { pokeListeners.add(fn); return () => pokeListeners.delete(fn) },
  poke() { ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'poke' })) },

  connect() {
    if (ws && ws.readyState <= 1) return
    status = 'connecting'
    try {
      ws = new WebSocket(relayUrl())
    } catch {
      return scheduleReconnect()
    }
    ws.onopen = () => {
      status = 'on'
      // only consider the link healthy once it has stayed up a while (no fast reconnect loops)
      clearTimeout(stableTimer)
      stableTimer = window.setTimeout(() => (retry = 0), 10_000)
      clearTimeout(clearPeersTimer)
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
      if (m.t === 'poke-match') pokeListeners.forEach((fn) => fn(m.peer))
      if (m.t === 'hand') handListeners.forEach((fn) => fn(m))
      if (m.t === 'ack') ackListeners.forEach((fn) => fn(m))
      if (m.t === 'delivered' || m.t === 'undelivered') {
        pendingSends.get(m.ref)?.(m.t === 'delivered')
        pendingSends.delete(m.ref)
      }
    }
    ws.onclose = () => {
      status = 'off'
      clearTimeout(stableTimer)
      // keep showing who was around for a moment: a quick reconnect shouldn't make people blink
      clearTimeout(clearPeersTimer)
      clearPeersTimer = window.setTimeout(() => {
        peers = []
        peerListeners.forEach((fn) => fn(peers))
      }, 4000)
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

let stableTimer = 0
let clearPeersTimer = 0
let reconnectTimer = 0
function scheduleReconnect() {
  // backoff with jitter: 0.5s, 1s, 2s… up to 15s
  const delay = Math.min(15000, 500 * 2 ** retry++) * (0.75 + Math.random() * 0.5)
  clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(() => relay.connect(), delay)
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
