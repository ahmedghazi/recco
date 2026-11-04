/**
 * relay.mjs: the tiny relay server (Node + ws). No database, nothing stored, everything in memory.
 * Run locally: node server/relay.mjs (PORT, default 8787). Deployed on Fly as "recco-relay"
 * (see Dockerfile, fly.toml; deploy with: fly deploy --ha=false --remote-only).
 *
 * What it does:
 * - presence, "around" = people on the same network (same public IP, IPv6 /64, or LAN /24)
 *                        + friends online anywhere + people who typed the same 4-letter code
 * - forwards hands (send) and delivery / "kept" acks between apps
 * - pairs pokes: two phones reporting a knock within POKE_WINDOW are matched
 * One person can be connected several times (tab + installed app): they count as one peer
 * and all their connections receive. Network ids are salted hashes, never raw IPs.
 */
import { WebSocketServer } from 'ws'
import { createHash } from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const SALT = process.env.RELAY_SALT || 'recco'

// One entry per open connection. The same person can be connected several times
// (browser tab + installed app share an id): they all count as one peer and all receive.
const conns = new Set()
const byId = (id) => [...conns].filter((c) => c.id === id)
const pokes = [] // recent shocks waiting for a partner: { c, at }
const POKE_WINDOW = 700 // ms between the two phones' reports (network jitter included)
const POKE_TTL = 1500
const onlineCount = () => new Set([...conns].map((c) => c.id)).size

const isPrivate = (ip) =>
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip)

/** Expand an IPv6 address to 8 groups so prefixes compare reliably. */
function expand6(ip) {
  const [head, tail = ''] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = Array(Math.max(0, 8 - h.length - t.length)).fill('0')
  return [...h, ...fill, ...t].map((g) => g.padStart(4, '0').toLowerCase())
}

function clientIp(req) {
  const fly = String(req.headers['fly-client-ip'] || '').trim()
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return (fly || fwd || req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

function networkKey(req) {
  let ip = clientIp(req)
  if (ip.includes(':')) {
    // IPv6: every phone on the same wifi has its own address, but they share the /64 prefix
    ip = isPrivate(ip) ? 'local6' : expand6(ip).slice(0, 4).join(':')
  } else if (isPrivate(ip)) {
    // LAN dev setup: every phone has its own private IP, group by /24
    ip = ip.split('.').slice(0, 3).join('.')
  }
  return createHash('sha256').update(SALT + ip).digest('hex').slice(0, 12)
}

const send = (c, msg) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(msg))
const areFriends = (a, b) => a.friends.has(b.id) || b.friends.has(a.id)

const RANK = { code: 3, network: 2, online: 1 }
function peersFor(me) {
  const best = new Map()
  for (const c of conns) {
    if (!c.id || c.id === me.id) continue
    const friend = areFriends(me, c)
    let how = null
    if (me.code && c.code === me.code) how = 'code'
    else if (c.net === me.net && (friend || (c.visible === 'network' && me.visible === 'network'))) how = 'network'
    else if (friend) how = 'online'
    if (!how) continue
    const prev = best.get(c.id)
    if (!prev || RANK[how] > RANK[prev.how]) best.set(c.id, { id: c.id, name: c.name, friend, how })
  }
  const out = [...best.values()]
  // friends first, then same network, then code
  return out.sort((a, b) => Number(b.friend) - Number(a.friend) || a.name.localeCompare(b.name))
}

let pending = null
function refreshAll() {
  // coalesce bursts of joins/leaves
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    for (const c of conns) if (c.id) send(c, { t: 'around', peers: peersFor(c) })
  }, 50)
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
  res.end(`relay ok · ${onlineCount()} online · ${conns.size} connections\n`)
})
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const net = networkKey(req)
  let me = null

  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw) } catch { return }
    if (m.t === 'hello' && typeof m.id === 'string') {
      // no kicking: a second connection with the same id (another tab, the installed app) just joins
      if (me) conns.delete(me)
      me = {
        ws, net, id: m.id.slice(0, 40),
        name: String(m.name || 'Someone').slice(0, 24),
        friends: new Set((m.friends || []).slice(0, 500)),
        visible: m.visible === 'friends' ? 'friends' : 'network',
      }
      conns.add(me)
      // short network id: two phones on the same wifi should show the same 4 characters
      send(me, { t: 'welcome', net: net.slice(0, 4) })
      console.log(`hello net=${net.slice(0, 4)} ip=v${clientIp(req).includes(':') ? 6 : 4} online=${onlineCount()} conns=${conns.size}`)
      refreshAll()
      return
    }
    if (!me) return
    if (m.t === 'update') {
      if (m.name) me.name = String(m.name).slice(0, 24)
      if (Array.isArray(m.friends)) me.friends = new Set(m.friends.slice(0, 500))
      if (m.visible) me.visible = m.visible === 'friends' ? 'friends' : 'network'
      refreshAll()
    }
    if (m.t === 'poke') {
      // two phones touched together: both report a shock within POKE_WINDOW ms
      const now = Date.now()
      for (let i = pokes.length - 1; i >= 0; i--) if (now - pokes[i].at > POKE_TTL || !conns.has(pokes[i].c)) pokes.splice(i, 1)
      const cands = pokes.filter((p) => p.c.id !== me.id && Math.abs(p.at - now) <= POKE_WINDOW)
      // prefer someone on the same network, then the closest in time
      cands.sort((a, b) => Number(b.c.net === me.net) - Number(a.c.net === me.net) || Math.abs(a.at - now) - Math.abs(b.at - now))
      const other = cands[0]
      if (other) {
        pokes.splice(pokes.indexOf(other), 1)
        send(me, { t: 'poke-match', peer: { id: other.c.id, name: other.c.name } })
        send(other.c, { t: 'poke-match', peer: { id: me.id, name: me.name } })
        console.log(`poke match dt=${now - other.at}ms sameNet=${other.c.net === me.net}`)
      } else {
        pokes.push({ c: me, at: now })
      }
      return
    }
    if (m.t === 'code') {
      me.code = m.code ? String(m.code).toUpperCase().slice(0, 6) : undefined
      refreshAll()
    }
    if (m.t === 'send' || m.t === 'ack') {
      const targets = byId(m.to)
      // only deliver to someone this client can actually see
      if (!targets.length || !peersFor(me).some((p) => p.id === m.to)) return send(me, { t: 'undelivered', to: m.to, ref: m.ref })
      if (m.t === 'send') {
        if (JSON.stringify(m.payload || {}).length > 32_000) return send(me, { t: 'undelivered', to: m.to, ref: m.ref })
        for (const to of targets) send(to, { t: 'hand', from: { id: me.id, name: me.name }, friend: areFriends(me, to), payload: m.payload, ref: m.ref })
        send(me, { t: 'delivered', to: m.to, ref: m.ref })
      } else {
        for (const to of targets) send(to, { t: 'ack', from: { id: me.id, name: me.name }, ref: m.ref, kept: !!m.kept })
      }
    }
  })

  ws.on('close', () => {
    if (me) conns.delete(me)
    refreshAll()
  })
})

// drop dead sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue }
    ws.isAlive = false
    ws.ping()
  }
}, 20_000)
wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true)) })

server.listen(PORT, () => console.log(`relay listening on :${PORT}`))
