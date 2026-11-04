/**
 * code.ts: connect with a 4-letter code, for when you're not on the same wifi and can't poke.
 *
 * The sheet has two halves:
 *   1. Your code: read it out; your friend types it on their phone.
 *   2. Friend's code: or type the code their phone shows.
 * Either way both phones end up in the same "code room" on the relay and see each other in
 * "around" (labelled "Code") for as long as the Send screen stays open. The sheet confirms
 * "Connected with Tom" and closes by itself.
 * Your code stays the same for the whole visit, so reopening the sheet doesn't change it.
 */
import { relay, type Peer } from './relay'
import { closeOverlay, pushOverlay } from './notify'
import { logGateway } from './store'

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I / O: easy to read out loud
export const myCode = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('')
let joined: string | null = null // a friend's code we typed, kept while the Send screen is open

/** Called when the Send screen closes: leave any code room. */
export function leaveCode() {
  joined = null
  relay.setCode(null)
}

export function openCodeSheet() {
  relay.setCode(joined || myCode)
  logGateway('code', joined ? `joined ${joined}` : `showing ${myCode}`)

  const sh = document.createElement('div')
  sh.className = 'sheet code-sheet'
  sh.innerHTML = `
    <div class="sheet-card">
      <div class="cs-head"><b>Connect with a code</b><button class="cs-x" data-x>Close</button></div>
      <section class="cs-part">
        <span class="cs-n">1</span>
        <div>
          <p class="cs-h">Your code</p>
          <p class="cs-code" aria-label="Your code ${myCode.split('').join(' ')}">${myCode}</p>
          <p class="muted small">Read it out to your friend: they type it on their phone (Send → Code).</p>
        </div>
      </section>
      <p class="cs-or"><span>or</span></p>
      <section class="cs-part">
        <span class="cs-n">2</span>
        <div>
          <p class="cs-h">Friend's code</p>
          <input id="csIn" class="cs-input" maxlength="4" placeholder="ABCD" value="${joined || ''}" inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Your friend's 4-letter code">
          <p class="muted small">Type the 4 letters their phone shows.</p>
        </div>
      </section>
      <p class="cs-status" id="csStatus" role="status" aria-live="polite"></p>
    </div>`
  document.body.append(sh)

  const input = sh.querySelector<HTMLInputElement>('#csIn')!
  const status = sh.querySelector<HTMLElement>('#csStatus')!
  const set = (text: string, ok = false) => {
    status.textContent = text
    status.classList.toggle('ok', ok)
  }
  set(joined ? `Looking for ${joined}…` : 'Waiting for your friend…')

  let done = false
  let closeTimer = 0
  const unsub = relay.onPeers((peers: Peer[]) => {
    const p = peers.find((x) => x.how === 'code')
    if (!p || done) return
    done = true
    set(`✓ Connected with ${p.name}. Flick the card toward them.`, true)
    navigator.vibrate?.([15, 40, 15])
    closeTimer = window.setTimeout(() => closeOverlay(), 1600)
  })

  input.addEventListener('input', () => {
    const v = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
    input.value = v
    if (v.length < 4) {
      if (joined) (joined = null), relay.setCode(myCode) // back to your own code
      return set('Waiting for your friend…')
    }
    if (v === myCode) return set("That's your own code: type your friend's.")
    joined = v
    relay.setCode(v)
    logGateway('code', `joined ${v}`)
    input.blur()
    set(`Looking for ${v}…`)
    window.setTimeout(() => !done && joined === v && set(`Nobody on ${v} yet. Check the letters, and that their Send screen is open.`), 4000)
  })

  sh.addEventListener('click', (e) => {
    if (e.target === sh || (e.target as HTMLElement).closest('[data-x]')) closeOverlay()
  })
  pushOverlay(() => {
    unsub()
    clearTimeout(closeTimer)
    sh.remove()
  })
}
