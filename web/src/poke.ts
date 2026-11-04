// Poke to connect: touch phones together (like clinking glasses). Each phone feels the shock,
// tells the relay "now!", and the relay pairs the two shocks that land in the same instant.
import { relay, addFriend } from './relay'
import { closeOverlay, pushOverlay } from './notify'
import { token } from './tokens'

type MotionPerm = { requestPermission?: () => Promise<'granted' | 'denied'> }

/** iPhone needs a permission tap before it shares motion sensors; must run inside the tap. */
async function motionAllowed(): Promise<boolean> {
  const D = (window as any).DeviceMotionEvent as MotionPerm | undefined
  if (!D) return false
  if (typeof D.requestPermission === 'function') {
    try {
      return (await D.requestPermission()) === 'granted'
    } catch {
      return false
    }
  }
  return true
}

export function openPoke(toast: (m: string) => void, onConnected?: (peer: { id: string; name: string }) => void) {
  // ask for the sensors right away, while we're still inside the user's tap
  const allowed = motionAllowed()
  const threshold = token('--poke-threshold', 22) // m/s², shock strength that counts as a poke
  const el = document.createElement('div')
  el.className = 'poke'
  el.innerHTML = `
    <div class="stage-top"><span>Poke to connect</span><span></span><button class="x">Close</button></div>
    <div class="poke-body">
      <div class="poke-ring"><div class="poke-dot"></div></div>
      <h2>Touch phones together</h2>
      <p class="muted" id="pokeHint">Both of you on this screen, then tap the phones against each other — like clinking glasses.</p>
      <div class="poke-meter" aria-hidden="true"><i id="pokeBar"></i><b id="pokeMark"></b></div>
      <p class="muted small" id="pokeVal">Waiting for motion…</p>
      <button class="ghost" id="pokeTap">No motion sensor? Tap here at the same moment</button>
    </div>`
  document.body.append(el)

  let last = 0
  let peak = 0
  let lowTimer = 0
  let done = false
  const hint = el.querySelector<HTMLElement>('#pokeHint')!
  const bar = el.querySelector<HTMLElement>('#pokeBar')!
  const val = el.querySelector<HTMLElement>('#pokeVal')!
  el.querySelector<HTMLElement>('#pokeMark')!.style.left = `${Math.min(100, (threshold / 40) * 100)}%`

  const fire = (how: string) => {
    const now = performance.now()
    if (now - last < 900 || done) return // one poke per touch
    last = now
    relay.poke()
    el.classList.remove('hit')
    void el.offsetWidth
    el.classList.add('hit')
    navigator.vibrate?.(30)
    hint.textContent = how === 'tap' ? 'Tapped — waiting for the other phone…' : 'Felt it — waiting for the other phone…'
    clearTimeout(lowTimer)
    lowTimer = window.setTimeout(() => {
      if (!done) hint.textContent = 'No match. Try again, both at the same moment.'
    }, 2000)
  }

  const onMotion = (e: DeviceMotionEvent) => {
    // linear acceleration without gravity when available; otherwise remove ~1g from the total
    const a = e.acceleration
    let m: number
    if (a && a.x != null) m = Math.hypot(a.x || 0, a.y || 0, a.z || 0)
    else {
      const g = e.accelerationIncludingGravity
      m = g ? Math.abs(Math.hypot(g.x || 0, g.y || 0, g.z || 0) - 9.81) : 0
    }
    peak = Math.max(m, peak * 0.92)
    bar.style.width = `${Math.min(100, (peak / 40) * 100)}%`
    val.textContent = `Shock ${m.toFixed(1)} m/s² · needs ${threshold}`
    if (m > threshold) fire('motion')
  }

  // listen anyway: some browsers report "denied" yet still deliver events
  window.addEventListener('devicemotion', onMotion)
  allowed.then((ok) => {
    if (!done && !ok) val.textContent = 'Motion sensors not available here: use the tap button below.'
  })

  const unsub = relay.onPokeMatch((peer) => {
    if (done) return
    done = true
    clearTimeout(lowTimer)
    window.removeEventListener('devicemotion', onMotion)
    navigator.vibrate?.([20, 50, 20])
    el.querySelector('.poke-body')!.innerHTML = `
      <div class="poke-ring matched"><div class="poke-dot"></div></div>
      <p class="eyebrow">Poked</p>
      <h2>Connect with ${escapeHtml(peer.name)}?</h2>
      <p class="muted">You'll see each other in “around” whenever both apps are open, anywhere.</p>
      <div class="row"><button class="big" data-a="yes">Connect</button><button class="ghost big" data-a="no">Not them</button></div>`
    el.querySelector('[data-a=yes]')!.addEventListener('click', () => {
      addFriend(peer.id, peer.name)
      toast(`Connected with ${peer.name}`)
      onConnected?.(peer)
      closeOverlay()
    })
    el.querySelector('[data-a=no]')!.addEventListener('click', () => closeOverlay())
  })

  const cleanup = () => {
    done = true
    unsub()
    clearTimeout(lowTimer)
    window.removeEventListener('devicemotion', onMotion)
    el.remove()
  }
  pushOverlay(cleanup)
  el.querySelector('.x')!.addEventListener('click', () => closeOverlay())
  el.querySelector('#pokeTap')!.addEventListener('click', () => fire('tap'))
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
