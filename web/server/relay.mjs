// Tiny relay: finds who's around and forwards hands. No database, nothing stored.
// Run: node server/relay.mjs   (PORT env, default 8787)
//
// "Around" = people on the same network (same public IP, or same /24 on a LAN)
//          + friends online anywhere
//          + people who typed the same 4-letter code.
import { WebSocketServer } from 'ws'
import { createHash } from 'node:crypto'
import http from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const SALT = process.env.RELAY_SALT || 'recco'

/** @type {Map<string, {ws:any, id:string, name:string, net:string, friends:Set<string>, visible:'network'|'friends', code?:string}>} */
const clients = new Map()

const isPrivate = (ip) =>
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip)

function networkKey(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  let ip = (fwd || req.socket.remoteAddress || '').replace(/^::ffff:/, '')
  // On a LAN dev setup every phone has its own private IP: group by /24 instead
  if (isPrivate(ip)) ip = ip.includes('.') ? ip.split('.').slice(0, 3).join('.') : 'local'
  return createHash('sha256').update(SALT + ip).digest('hex').slice(0, 12)
}

const send = (c, msg) => c.ws.readyState === 1 && c.ws.send(JSON.stringify(msg))
const areFriends = (a, b) => a.friends.has(b.id) || b.friends.has(a.id)

function peersFor(me) {
  const out = []
  for (const c of clients.values()) {
    if (c.id === me.id) continue
    const friend = areFriends(me, c)
    let how = null
    if (me.code && c.code === me.code) how = 'code'
    else if (c.net === me.net && (friend || (c.visible === 'network' && me.visible === 'network'))) how = 'network'
    else if (friend) how = 'online'
    if (how) out.push({ id: c.id, name: c.name, friend, how })
  }
  // friends first, then same network, then code
  return out.sort((a, b) => Number(b.friend) - Number(a.friend) || a.name.localeCompare(b.name))
}

let pending = null
function refreshAll() {
  // coalesce bursts of joins/leaves
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    for (const c of clients.values()) send(c, { t: 'around', peers: peersFor(c) })
  }, 50)
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' })
  res.end(`relay ok · ${clients.size} online\n`)
})
const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  const net = networkKey(req)
  let me = null

  ws.on('message', (raw) => {
    let m
    try { m = JSON.parse(raw) } catch { return }
    if (m.t === 'hello' && typeof m.id === 'string') {
      const old = clients.get(m.id)
      if (old && old.ws !== ws) old.ws.close()
      me = {
        ws, net, id: m.id.slice(0, 40),
        name: String(m.name || 'Someone').slice(0, 24),
        friends: new Set((m.friends || []).slice(0, 500)),
        visible: m.visible === 'friends' ? 'friends' : 'network',
      }
      clients.set(me.id, me)
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
    if (m.t === 'code') {
      me.code = m.code ? String(m.code).toUpperCase().slice(0, 6) : undefined
      refreshAll()
    }
    if (m.t === 'send' || m.t === 'ack') {
      const to = clients.get(m.to)
      // only deliver to someone this client can actually see
      if (!to || !peersFor(me).some((p) => p.id === to.id)) return send(me, { t: 'undelivered', to: m.to, ref: m.ref })
      if (m.t === 'send') {
        if (JSON.stringify(m.payload || {}).length > 32_000) return send(me, { t: 'undelivered', to: m.to, ref: m.ref })
        send(to, { t: 'hand', from: { id: me.id, name: me.name }, friend: areFriends(me, to), payload: m.payload, ref: m.ref })
        send(me, { t: 'delivered', to: m.to, ref: m.ref })
      } else {
        send(to, { t: 'ack', from: { id: me.id, name: me.name }, ref: m.ref, kept: !!m.kept })
      }
    }
  })

  ws.on('close', () => {
    if (me && clients.get(me.id)?.ws === ws) clients.delete(me.id)
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
