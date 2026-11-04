/**
 * radial.ts: Tumblr-style hold-to-send.
 *
 * Hold a Send button (--hold-delay): destinations pop out in an arc around the finger
 * (people around, Share, Copy link…); slide onto one and let go. A short tap still behaves like
 * a normal click, so the same button opens the Send screen. Used by wireRadial() in main.ts.
 */
import { token } from './tokens'

export interface RadialItem {
  id: string
  label: string // short text under the bubble
  glyph: string // letter or symbol inside the bubble
  kind: 'peer' | 'action'
  run: () => void // called synchronously on release (keeps user activation for navigator.share)
}


export function attachRadial(btn: HTMLElement, items: () => RadialItem[], onHoldStart?: () => void) {
  let timer = 0
  let open: { root: HTMLElement; els: { el: HTMLElement; item: RadialItem; x: number; y: number }[]; hot: number } | null = null
  let suppressClick = false

  btn.style.setProperty('-webkit-touch-callout', 'none')
  btn.style.userSelect = 'none'
  btn.style.touchAction = 'none' // sliding to a bubble must not scroll the page
  btn.addEventListener('contextmenu', (e) => e.preventDefault())

  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const x = e.clientX, y = e.clientY
    const id = e.pointerId
    timer = window.setTimeout(() => {
      onHoldStart?.()
      try { btn.setPointerCapture(id) } catch {}
      open = show(x, y, items())
      suppressClick = true
      navigator.vibrate?.(12)
    }, token('--hold-delay', 280))
  })

  btn.addEventListener('pointermove', (e) => {
    if (!open) return
    // nearest bubble within reach becomes "hot"
    let best = -1, bestD = 56
    open.els.forEach((b, i) => {
      const d = Math.hypot(e.clientX - b.x, e.clientY - b.y)
      if (d < bestD) (bestD = d), (best = i)
    })
    if (best !== open.hot) {
      open.els.forEach((b, i) => b.el.classList.toggle('hot', i === best))
      open.hot = best
      if (best >= 0) navigator.vibrate?.(6)
    }
  })

  const end = () => {
    clearTimeout(timer)
    if (!open) return
    const pick = open.hot >= 0 ? open.els[open.hot].item : null
    const root = open.root
    open = null
    if (pick) {
      root.querySelectorAll('.rb').forEach((el) => el.classList.add('gone'))
      root.querySelector('.rb.hot')?.classList.add('chosen')
      pick.run() // synchronous: share sheet needs the gesture
    }
    root.classList.add('out')
    setTimeout(() => root.remove(), 260)
  }
  btn.addEventListener('pointerup', end)
  btn.addEventListener('pointercancel', end)

  // a hold must not also trigger the button's normal click
  btn.addEventListener(
    'click',
    (e) => {
      if (!suppressClick) return
      suppressClick = false
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )
}

function show(cx: number, cy: number, items: RadialItem[]) {
  const root = document.createElement('div')
  root.className = 'radial'
  const W = window.innerWidth, H = window.innerHeight
  // arc above the finger (or below if the finger is near the top), flipped toward the screen's center
  const up = cy > 220
  const n = items.length
  const r = n <= 4 ? 92 : n <= 6 ? 108 : 124
  const spread = Math.min(160, 40 + n * 24) * (Math.PI / 180)
  const center = up ? -Math.PI / 2 : Math.PI / 2
  // lean the arc away from the screen edge the finger is close to
  const lean = ((W / 2 - cx) / (W / 2)) * 0.6 * (up ? 1 : -1)
  const els = items.map((item, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    const a = center + lean + t * spread
    let x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r
    x = Math.max(34, Math.min(W - 34, x))
    y = Math.max(40, Math.min(H - 40, y))
    const el = document.createElement('div')
    el.className = `rb ${item.kind}`
    el.innerHTML = `<i></i><span></span>`
    el.querySelector('i')!.textContent = item.glyph
    el.querySelector('span')!.textContent = item.label
    el.style.left = `${cx}px`
    el.style.top = `${cy}px`
    el.style.transitionDelay = `${i * 28}ms`
    root.append(el)
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.classList.add('in')
    }))
    return { el, item, x, y }
  })
  const dot = document.createElement('div')
  dot.className = 'radial-dot'
  dot.style.left = `${cx}px`
  dot.style.top = `${cy}px`
  root.append(dot)
  if (!items.some((i) => i.kind === 'peer')) {
    const hint = document.createElement('p')
    hint.className = 'radial-hint'
    hint.textContent = 'Nobody around — slide to share'
    hint.style.top = `${up ? cy - r - 70 : cy + r + 50}px`
    root.append(hint)
  }
  document.body.append(root)
  return { root, els, hot: -1 }
}
