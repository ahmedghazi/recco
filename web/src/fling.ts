// Drag-and-fling: lift the hand, aim, flick, it flies off in that direction.
// The share sheet fallback must be called inside pointerup (user activation),
// so `onFling` runs synchronously and the animation plays alongside.

export interface Vec { x: number; y: number }

export function attachFling(
  card: HTMLElement,
  onFling: (dir: Vec) => void,
  onAim?: (dir: Vec | null) => void,
) {
  let startX = 0, startY = 0, x = 0, y = 0, lastX = 0, lastY = 0, lastT = 0, vx = 0, vy = 0, active = false

  const setT = (tx: number, ty: number, extra = '') => {
    card.style.transform = `translate(${tx}px, ${ty}px) rotate(${tx / 18}deg) ${extra}`
  }

  card.addEventListener('pointerdown', (e) => {
    active = true
    startX = e.clientX; startY = e.clientY; x = 0; y = 0
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp; vx = 0; vy = 0
    card.setPointerCapture(e.pointerId)
    card.classList.add('lifted')
    card.style.transition = 'none'
    navigator.vibrate?.(8)
  })

  card.addEventListener('pointermove', (e) => {
    if (!active) return
    x = e.clientX - startX
    y = e.clientY - startY
    const dt = Math.max(1, e.timeStamp - lastT)
    vx = 0.8 * vx + 0.2 * ((e.clientX - lastX) / dt)
    vy = 0.8 * vy + 0.2 * ((e.clientY - lastY) / dt)
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp
    setT(x, Math.min(y, 40) + (y > 40 ? (y - 40) * 0.2 : 0), 'scale(1.03)')
    onAim?.(y < -20 ? { x, y } : null)
  })

  const end = () => {
    if (!active) return
    active = false
    card.classList.remove('lifted')
    const flicked = vy < -0.6 || y < -window.innerHeight * 0.22
    if (flicked) {
      // direction = blend of drag offset and release velocity
      const dir = { x: x + vx * 120, y: Math.min(-1, y + vy * 120) }
      onFling(dir)
      navigator.vibrate?.([12, 30, 18])
      const k = (window.innerHeight * 1.1) / Math.abs(dir.y)
      card.style.transition = 'transform .45s cubic-bezier(.2,.7,.2,1), opacity .45s'
      setT(dir.x * k, dir.y * k, 'scale(.6)')
      card.style.opacity = '0'
      setTimeout(() => {
        card.style.transition = 'none'
        setT(0, 60, 'scale(.9)')
        requestAnimationFrame(() => {
          card.style.transition = 'transform .5s cubic-bezier(.2,1.4,.4,1), opacity .3s'
          card.style.opacity = '1'
          setT(0, 0)
        })
      }, 900)
    } else {
      onAim?.(null)
      card.style.transition = 'transform .4s cubic-bezier(.2,1.4,.4,1)'
      setT(0, 0)
    }
  }
  card.addEventListener('pointerup', end)
  card.addEventListener('pointercancel', end)
}

/** Pick the target whose direction from `origin` best matches `dir`. */
export function pickTarget(origin: HTMLElement, targets: HTMLElement[], dir: Vec): HTMLElement | null {
  if (!targets.length) return null
  if (targets.length === 1) return targets[0]
  const o = origin.getBoundingClientRect()
  const ox = o.left + o.width / 2, oy = o.top + o.height / 2
  const a = Math.atan2(dir.y, dir.x)
  let best: HTMLElement | null = null, bestD = Infinity
  for (const t of targets) {
    const r = t.getBoundingClientRect()
    const ta = Math.atan2(r.top + r.height / 2 - oy, r.left + r.width / 2 - ox)
    const d = Math.abs(Math.atan2(Math.sin(a - ta), Math.cos(a - ta)))
    if (d < bestD) (bestD = d), (best = t)
  }
  return best
}

/** Receiver side: the card drops in from the top edge. */
export function flyIn(el: HTMLElement) {
  // slow, soft landing: falls from above, drifts, settles
  el.style.opacity = '1'
  el.animate(
    [
      { transform: 'translateY(-70vh) rotate(-7deg) scale(.9)', opacity: 0 },
      { transform: 'translateY(-8vh) rotate(-2deg) scale(.98)', opacity: 1, offset: 0.55 },
      { transform: 'translateY(6px) rotate(.6deg) scale(1.005)', opacity: 1, offset: 0.85 },
      { transform: 'translateY(0) rotate(0) scale(1)', opacity: 1 },
    ],
    { duration: 1400, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' },
  )
  navigator.vibrate?.(10)
}
