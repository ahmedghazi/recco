import { token } from './tokens'

// Overlays that close with the phone's back gesture, and "something arrived" signals:
// an in-app banner + soft chime + vibration, and a system notification when the app is in the background.

// ---------- back gesture closes overlays ----------
// Overlays stack (e.g. Poke opened from the Send screen); back closes the top one only.
const closers: (() => void)[] = []
let after: (() => void) | null = null

/** Register an open overlay: the phone's back gesture (or Android back button) will close it. */
export function pushOverlay(close: () => void) {
  closers.push(close)
  history.pushState({ overlay: true }, '', location.href)
}

/** Close the top overlay (pops the history entry it added), then optionally run `then`. */
export function closeOverlay(then?: () => void) {
  if (!closers.length) return then?.()
  after = then || null
  if (history.state?.overlay) history.back()
  else runClose()
}

function runClose() {
  const c = closers.pop(), a = after
  after = null
  c?.()
  a?.()
}

window.addEventListener('popstate', () => {
  if (closers.length) runClose()
})

// ---------- in-app signal ----------
let audio: AudioContext | null = null

/** Two soft notes. Silent if the browser hasn't allowed audio yet. */
export function chime() {
  try {
    audio = audio || new AudioContext()
    if (audio.state === 'suspended') audio.resume()
    const t = audio.currentTime
    for (const [f, d] of [[660, 0], [990, 0.14]] as const) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.setValueAtTime(0, t + d)
      g.gain.linearRampToValueAtTime(0.08, t + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.5)
      o.connect(g).connect(audio.destination)
      o.start(t + d)
      o.stop(t + d + 0.55)
    }
  } catch {}
}

/** A banner that slides down from the top, then goes away. Resolves when it's done. */
export function banner(line1: string, line2: string, ms = token('--banner-duration', 1400)): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement('div')
    el.className = 'arrival'
    el.innerHTML = `<span></span><b></b>`
    el.querySelector('span')!.textContent = line1
    el.querySelector('b')!.textContent = line2
    document.body.append(el)
    navigator.vibrate?.([20, 60, 20])
    chime()
    requestAnimationFrame(() => el.classList.add('in'))
    setTimeout(() => {
      el.classList.remove('in')
      setTimeout(() => (el.remove(), resolve()), 450)
    }, ms)
  })
}

// ---------- system notifications ----------
export const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator
export const notifyState = (): NotificationPermission | 'unsupported' => (canNotify() ? Notification.permission : 'unsupported')

/** Must be called from a tap. On iPhone this only works once the app is on the home screen. */
export async function askNotify(): Promise<boolean> {
  if (!canNotify()) return false
  if (Notification.permission === 'granted') return true
  try {
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

/** Show a system notification, only when the app isn't on screen. */
export async function systemNotify(title: string, body: string, tag: string) {
  if (!canNotify() || Notification.permission !== 'granted' || document.visibilityState === 'visible') return
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: location.href } })
  } catch {
    try { new Notification(title, { body, tag }) } catch {}
  }
}
