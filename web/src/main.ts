import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import './style.css'
import './title-page.css'
import { APP_NAME } from './config'
import { addToLibrary, libraryList, logGateway, now, onChange, save, state, uid, type LibItem, type List, type Title } from './store'
import { hasTmdb, poster, search } from './tmdb'
import { parseShared, resolve } from './resolve'
import { detectAndMap } from './csv'
import { appBase, decode, encode, payloadFile, qrDataUrl, shareUrl, buildPayload, support, type Payload } from './share'
import { attachFling, flyIn, pickTarget, type Vec } from './fling'
import { relay, addFriend, type IncomingHand, type Peer } from './relay'

const app = document.getElementById('app')!
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!

// ---------- helpers ----------
function toast(msg: string) {
  const t = document.createElement('div')
  t.className = 'toast'
  t.textContent = msg
  document.body.append(t)
  setTimeout(() => t.classList.add('out'), 2200)
  setTimeout(() => t.remove(), 2600)
}

function posterHtml(t: Pick<Title, 'title' | 'poster' | 'year'>, size = 'w342') {
  if (t.poster) return `<img class="poster" loading="lazy" src="${poster(t.poster, size)}" alt="">`
  return `<div class="poster ph"><span>${esc(t.title)}</span></div>`
}

const pad = (n: number) => String(n).padStart(2, '0')
const titles = (n: number) => `${pad(n)} ${n === 1 ? 'title' : 'titles'}`
const mediaLabel = (m?: string) => (m === 'tv' ? 'Series' : m === 'podcast' ? 'Podcast' : m === 'music' ? 'Music' : 'Film')

interface CardData {
  title: string
  year?: number
  media?: string
  poster?: string
  note?: string
  from: string
  origin?: string
  rank?: number
  total?: number
  rarity?: number // how many people dealt it
}

/** A title card: one title, one note, who it's from. */
function cardHtml(c: CardData) {
  return `<article class="tcard">
    <header><span>${c.rank ? `${pad(c.rank)}/${pad(c.total || c.rank)}` : '—'}</span><span>${mediaLabel(c.media)}</span><span>${c.year ?? ''}</span></header>
    <div class="art">${posterHtml({ title: c.title, poster: c.poster }, 'w500')}</div>
    <h4>${esc(c.title)}</h4>
    <p class="cnote">${c.note ? esc(c.note) : '&nbsp;'}</p>
    <footer><span>From ${esc(c.from)}${c.origin ? ` / via ${esc(c.origin)}` : ''}</span></footer>
  </article>`
}

function fromLine(i: LibItem) {
  if (!i.recos.length) return ''
  const r = i.recos
  const names = r.length > 2 ? `${esc(r[0].from)}, ${esc(r[1].from)} +${r.length - 2}` : r.map((x) => esc(x.from)).join(' & ')
  const origin = r[0].origin ? ` <span class="muted">via ${esc(r[0].origin)}</span>` : ''
  return `<div class="from">from ${names}${origin}</div>`
}

function route() {
  return location.hash.replace(/^#\/?/, '').split('/')
}

// ---------- entry gateways: share target, bookmarklet, file launch ----------
async function handleIncoming() {
  const p = new URLSearchParams(location.search)
  const url = p.get('url') || p.get('add') || ''
  const text = p.get('text') || ''
  const title = p.get('title') || ''
  if (url || text || title) {
    const gw = p.has('add') ? 'bookmarklet' : 'share-target'
    history.replaceState(null, '', location.pathname + '#/collect')
    logGateway(gw, [title, text, url].filter(Boolean).join(' · ').slice(0, 140))
    await collectFrom({ url, text, title }, gw)
  }
  // Desktop PWA file handler (.recco.json opened from Finder)
  const lq = (window as any).launchQueue
  lq?.setConsumer(async (params: any) => {
    for (const h of params.files || []) {
      const f = await h.getFile()
      await openPayloadFile(f, 'file-handler')
    }
  })
}

async function collectFrom(input: { url?: string; text?: string; title?: string }, source: string, toldBy?: string) {
  const parsed = parseShared(input)
  if (!parsed) {
    toast('Nothing recognisable in that')
    logGateway(source, 'unrecognised input', false)
    return
  }
  const { title, candidates } = await resolve(parsed)
  const reco = toldBy ? { from: toldBy, at: now(), channel: 'told' } : undefined
  const item = addToLibrary(title, `${source}:${parsed.source}`, reco)
  save()
  logGateway(source, `${parsed.source} → ${item.title}${item.resolved ? '' : ' (unresolved)'}`, true)
  toast(`Saved · ${item.title}`)
  if (candidates.length) showCandidates(item, candidates)
}

function showCandidates(item: LibItem, candidates: Title[]) {
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.innerHTML = `
    <div class="sheet-card">
      <p class="eyebrow">Saved “${esc(item.title)}${item.year ? ` (${item.year})` : ''}”. Not the right one?</p>
      <div class="cand">${candidates
        .map((c, i) => `<button data-i="${i}">${posterHtml(c, 'w154')}<span>${esc(c.title)} <em>${c.year ?? ''}</em></span></button>`)
        .join('')}</div>
      <button class="ghost" data-close>Keep it</button>
    </div>`
  sheet.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b) return
    if (b.dataset.i) {
      const c = candidates[Number(b.dataset.i)]
      const old = state.library[item.key]
      delete state.library[item.key]
      const fresh = addToLibrary({ ...c, lbSlug: item.lbSlug, imdbId: item.imdbId }, item.source)
      fresh.recos = old?.recos || []
      state.lists.forEach((l) => l.items.forEach((li) => li.key === item.key && (li.key = fresh.key)))
      save()
    }
    sheet.remove()
  })
  document.body.append(sheet)
}

async function openPayloadFile(f: File, gw: string) {
  try {
    const p: Payload = JSON.parse(await f.text())
    if (p.v !== 1) throw new Error()
    logGateway(gw, `${f.name} from ${p.from}`)
    renderReceived(p, gw)
  } catch {
    logGateway(gw, `${f.name} not readable`, false)
    toast('Not a list file')
  }
}

// ---------- screens ----------
function shell(active: string, body: string) {
  const tab = (id: string, n: string, label: string) =>
    `<a href="#/${id}" class="${active === id ? 'on' : ''}"><span>${n}</span>${label}</a>`
  app.innerHTML = `
    <header class="top"><h1>${APP_NAME}</h1><span class="tag">Test build</span></header>
    <main>${body}</main>
    <nav class="tabs">
      ${tab('collect', '01', 'Collect')}
      ${tab('lists', '02', 'Lists')}
      ${tab('inbox', '03', 'Saved')}
      ${tab('gateways', '04', 'Gateways')}
    </nav>`
}

function needName(): boolean {
  if (state.me.name) return false
  shell('', `
    <section class="hero">
      <p class="eyebrow">Your name</p>
      <h2>It goes with everything you send.</h2>
      <form id="nameForm" class="row">
        <input name="n" placeholder="Your first name" autocomplete="given-name" required>
        <button>Start</button>
      </form>
    </section>`)
  $('#nameForm').addEventListener('submit', (e) => {
    e.preventDefault()
    state.me.name = String(new FormData(e.target as HTMLFormElement).get('n')).trim()
    save()
    render()
  })
  return true
}

function renderCollect() {
  const bookmarklet = `javascript:location='${appBase()}?add='+encodeURIComponent(location.href)`
  shell('collect', `
    <section>
      <form id="searchForm" class="row">
        <input name="q" type="search" placeholder="${hasTmdb() ? 'Search films & series' : 'Add a TMDB key in Gateways to search'}" ${hasTmdb() ? '' : 'disabled'}>
        <button ${hasTmdb() ? '' : 'disabled'}>Search</button>
      </form>
      <div id="results" class="grid"></div>
    </section>

    <section class="card">
      <h3>Paste a link</h3>
      <p class="muted">IMDb, Letterboxd, TMDB, Trakt, SensCritique, JustWatch — or “Title (2024)”.</p>
      <form id="pasteForm">
        <textarea name="t" rows="2" placeholder="https://letterboxd.com/film/past-lives/"></textarea>
        <input name="who" placeholder="Who told you? (optional)">
        <div class="row">
          <button type="button" id="clip" class="ghost">Paste from clipboard</button>
          <button>Save</button>
        </div>
      </form>
    </section>

    <section class="card">
      <h3>Import a watchlist</h3>
      <p class="muted">Letterboxd: Settings → Import & Export → Export your data → <code>watchlist.csv</code>.<br>IMDb: Your watchlist → ⋯ → Export.</p>
      <label class="file"><input type="file" id="csv" accept=".csv,text/csv"><span>Choose CSV</span></label>
      <label class="file"><input type="file" id="lfile" accept=".json,application/json"><span>Open a shared list file</span></label>
      <div id="csvStatus" class="muted"></div>
    </section>

    <section class="card">
      <h3>Other ways in</h3>
      <ul class="ways">
        <li><b>Android</b> — install the app, then use <em>Share → ${APP_NAME}</em> from any app.</li>
        <li><b>iPhone</b> — iOS doesn't let web apps appear in the share sheet. Copy the link and use “Paste from clipboard”, or make a Shortcut that opens <code>${esc(appBase())}?add=[Shortcut Input]</code>.</li>
        <li><b>Desktop</b> — drag this to your bookmarks bar, click it on any film page: <a class="bm" href="${esc(bookmarklet)}">＋ ${APP_NAME}</a></li>
      </ul>
    </section>`)

  $('#searchForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const q = String(new FormData(e.target as HTMLFormElement).get('q')).trim()
    if (!q) return
    const box = $('#results')
    box.innerHTML = '<p class="muted">Searching…</p>'
    try {
      const res = await search(q)
      box.innerHTML = res
        .slice(0, 12)
        .map((t, i) => `<button class="tile" data-i="${i}">${posterHtml(t)}<span>${esc(t.title)} <em>${t.year ?? ''}</em></span></button>`)
        .join('') || '<p class="muted">No results.</p>'
      box.onclick = (ev) => {
        const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-i]')
        if (!b) return
        const r = res[Number(b.dataset.i)]
        // second tap on a saved result opens its page (send from there)
        if (b.classList.contains('added')) return (location.hash = `#/t/${encodeURIComponent(r.key)}`)
        const it = addToLibrary(r, 'search')
        save()
        logGateway('search', it.title)
        b.classList.add('added')
        toast(`Saved · ${it.title} · tap again to open`)
      }
    } catch (err) {
      box.innerHTML = `<p class="err">TMDB error — check your key in Gateways. (${esc((err as Error).message)})</p>`
    }
  })

  $('#pasteForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    const text = String(fd.get('t')).trim()
    if (!text) return
    await collectFrom({ text }, 'paste', String(fd.get('who') || '').trim() || undefined)
  })

  $('#clip').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      $<HTMLTextAreaElement>('textarea[name=t]').value = text
      logGateway('clipboard', text.slice(0, 80))
    } catch {
      logGateway('clipboard', 'read blocked', false)
      toast('Clipboard blocked — long-press and paste instead')
    }
  })

  $('#csv').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f) await importCsv(f)
  })
  $('#lfile').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f) await openPayloadFile(f, 'file-open')
  })
}

async function importCsv(f: File) {
  const status = $('#csvStatus')
  const { source, rows } = detectAndMap(await f.text())
  if (source === 'unknown') {
    status.textContent = 'Not a Letterboxd or IMDb export.'
    logGateway('csv', `${f.name}: unknown format`, false)
    return
  }
  let done = 0
  for (const r of rows) {
    const parsed = r.imdbId
      ? parseShared({ url: `https://www.imdb.com/title/${r.imdbId}/` })!
      : { ...(parseShared({ url: r.lbUri, text: `${r.title} (${r.year})` }) || { kind: 'text' as const, source: 'csv' }), guess: r.title, year: r.year }
    const { title } = await resolve(parsed)
    const it = addToLibrary({ ...title, title: title.resolved ? title.title : r.title, year: title.year ?? r.year }, `csv:${source}`)
    if (r.watched) (it.status = 'watched'), (it.rating = r.rating)
    done++
    if (done % 5 === 0 || done === rows.length) status.textContent = `Imported ${done}/${rows.length}…`
    if (hasTmdb()) await new Promise((res) => setTimeout(res, 60)) // stay well under TMDB rate limits
  }
  save()
  logGateway('csv', `${source}: ${rows.length} titles`)
  toast(`Imported ${rows.length} from ${source === 'imdb' ? 'IMDb' : 'Letterboxd'}`)
}

function renderInbox() {
  const items = libraryList()
  const people = [...new Set(items.flatMap((i) => i.recos.map((r) => r.from)))]
  const filter = decodeURIComponent(route()[1] || '')
  const shown = filter ? items.filter((i) => i.recos.some((r) => r.from === filter)) : items
  shell('inbox', `
    ${people.length ? `<div class="chips"><a href="#/inbox" class="${filter ? '' : 'on'}">All</a>${people
      .map((p) => `<a href="#/inbox/${encodeURIComponent(p)}" class="${filter === p ? 'on' : ''}">from ${esc(p)}</a>`)
      .join('')}</div>` : ''}
    ${shown.length ? `<ul class="lib">${shown
      .map(
        (i) => `<li data-k="${esc(i.key)}" class="${i.status}">
          <a href="#/t/${encodeURIComponent(i.key)}">${posterHtml(i, 'w154')}</a>
          <div class="meta">
            <a class="tlink" href="#/t/${encodeURIComponent(i.key)}"><b>${esc(i.title)}</b></a> <span class="muted">${i.year ?? ''}${i.media === 'tv' ? ' · series' : ''}</span>
            ${fromLine(i)}
            ${i.recos.filter((r) => r.note).map((r) => `<q>${esc(r.note)}</q>`).join('')}
            ${i.resolved ? '' : `<span class="pill">unresolved${i.link ? ` · <a href="${esc(i.link)}" target="_blank" rel="noopener">link</a>` : ''}</span>`}
            <div class="acts">
              ${i.status === 'watched'
                ? `<span class="stars">${[2, 4, 6, 8, 10].map((n) => `<button data-rate="${n}">${(i.rating || 0) >= n ? '■' : '□'}</button>`).join('')}</span>`
                : '<button data-act="watched" class="ghost sm">Mark watched</button>'}
              <button data-act="send" class="sm">Send</button>
              <button data-act="del" class="ghost sm">Remove</button>
            </div>
          </div>
        </li>`,
      )
      .join('')}</ul>` : '<p class="empty">Nothing saved yet. Collect a few titles, or open a list someone sent you.</p>'}`)

  $('.lib', app)?.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    const li = t.closest<HTMLElement>('li')
    if (!li) return
    const item = state.library[li.dataset.k!]
    if (t.dataset.act === 'send') {
      // one title, no list needed: a throwaway single-item list that is never saved
      return openFling({ id: 'single', name: item.title, items: [{ key: item.key, note: item.myNote }], createdAt: now(), single: true })
    }
    if (t.dataset.act === 'watched') {
      item.status = 'watched'
      // MVP: with a backend this pings every sender ("Tom watched your pick")
      if (item.recos.length) toast(`${item.recos.map((r) => r.from).join(', ')} would get a ping`)
    }
    if (t.dataset.rate) item.rating = Number(t.dataset.rate)
    if (t.dataset.act === 'del') {
      delete state.library[item.key]
      state.lists.forEach((l) => (l.items = l.items.filter((x) => x.key !== item.key)))
    }
    save()
  })
}

// ---------- title page: one film / series / podcast, send it from here ----------
function sourceLink(i: LibItem): string | undefined {
  if (i.link) return i.link
  if (i.tmdbId && i.media) return `https://www.themoviedb.org/${i.media}/${i.tmdbId}`
  if (i.imdbId) return `https://www.imdb.com/title/${i.imdbId}/`
  if (i.lbSlug) return `https://letterboxd.com/film/${i.lbSlug}/`
  return undefined
}

function renderTitle(key: string) {
  const i = state.library[key]
  if (!i) return (location.hash = '#/inbox')
  const link = sourceLink(i)
  shell('inbox', `
    <a href="#/inbox" class="back">← Saved</a>
    <div class="tpage">
      <div class="tp-card">${cardHtml({ title: i.title, year: i.year, media: i.media, poster: i.poster, note: i.myNote || i.recos.find((r) => r.note)?.note, from: i.recos[0]?.from || state.me.name, origin: i.recos[0]?.origin })}</div>
      <div class="tp-meta">
        <p class="eyebrow">${mediaLabel(i.media)}${i.year ? ` · ${i.year}` : ''}</p>
        <h2>${esc(i.title)}</h2>
        ${i.recos.length ? `<ul class="recos">${i.recos
          .map((r) => `<li><span class="from">From ${esc(r.from)}${r.origin ? ` / via ${esc(r.origin)}` : ''}</span>${r.note ? `<q>${esc(r.note)}</q>` : ''}</li>`)
          .join('')}</ul>` : ''}
        <label>Your line, sent with it
          <input id="tpNote" maxlength="140" placeholder="One line: why watch it?" value="${esc(i.myNote)}"></label>
        <button id="tpSend" class="big wide">Send</button>
        <div class="acts">
          ${i.status === 'watched'
            ? `<span class="stars">${[2, 4, 6, 8, 10].map((n) => `<button data-rate="${n}">${(i.rating || 0) >= n ? '■' : '□'}</button>`).join('')}</span>`
            : '<button data-act="watched" class="ghost sm">Mark watched</button>'}
          ${link ? `<a class="ext" href="${esc(link)}" target="_blank" rel="noopener">Open source ↗</a>` : ''}
          <button data-act="del" class="ghost sm">Remove</button>
        </div>
      </div>
    </div>`)

  $('#tpNote').addEventListener('change', (e) => {
    i.myNote = (e.target as HTMLInputElement).value.trim() || undefined
    save()
  })
  $('#tpSend').addEventListener('click', () => {
    i.myNote = $<HTMLInputElement>('#tpNote').value.trim() || undefined
    save()
    openFling({ id: 'single', name: i.title, items: [{ key: i.key, note: i.myNote }], createdAt: now(), single: true })
  })
  $('.tp-meta .acts').addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.dataset.act === 'watched') {
      i.status = 'watched'
      if (i.recos.length) toast(`${i.recos.map((r) => r.from).join(', ')} would get a ping`)
    }
    if (t.dataset.rate) i.rating = Number(t.dataset.rate)
    if (t.dataset.act === 'del') {
      delete state.library[i.key]
      state.lists.forEach((l) => (l.items = l.items.filter((x) => x.key !== i.key)))
      location.hash = '#/inbox'
    }
    if (t.dataset.act || t.dataset.rate) {
      save()
      if (t.dataset.act !== 'del') renderTitle(key)
    }
  })
}

function renderLists() {
  const year = new Date().getFullYear()
  shell('lists', `
    <form id="newList" class="row">
      <input name="n" placeholder="List name" value="My Top 5 of ${year}">
      <select name="top"><option value="5">Top 5</option><option value="10">Top 10</option><option value="">Unranked</option></select>
      <button>New list</button>
    </form>
    ${state.lists.length ? `<div class="lists">${state.lists
      .map((l) => {
        const posters = l.items.slice(0, 4).map((li) => state.library[li.key]).filter(Boolean)
        return `<a class="list-card" href="#/list/${l.id}">
          <div class="collage">${posters.map((p) => posterHtml(p, 'w154')).join('')}</div>
          <b>${esc(l.name)}</b><span class="muted">${l.items.length}${l.topN ? `/${l.topN}` : ''} · ${l.from ? `from ${esc(l.from)}` : 'by you'}</span>
        </a>`
      })
      .join('')}</div>` : '<p class="empty">No lists yet. A Top 5 is perfect for a dinner table.</p>'}`)
  $('#newList').addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    const l: List = { id: uid(), name: String(fd.get('n')).trim() || 'Untitled', topN: Number(fd.get('top')) || undefined, items: [], createdAt: now() }
    state.lists.unshift(l)
    save()
    location.hash = `#/list/${l.id}`
  })
}

function renderList(id: string) {
  const l = state.lists.find((x) => x.id === id)
  if (!l) return (location.hash = '#/lists')
  const lib = libraryList().filter((i) => !l.items.some((x) => x.key === i.key))
  const full = !!l.topN && l.items.length >= l.topN
  shell('lists', `
    <a href="#/lists" class="back">← Lists</a>
    <div class="list-head">
      <h2 contenteditable="true" id="lname">${esc(l.name)}</h2>
      <button id="share" class="big" ${l.items.length ? '' : 'disabled'}>Send</button>
    </div>
    <ol class="items ${l.topN ? 'ranked' : ''}">${l.items
      .map((li, i) => {
        const t = state.library[li.key]
        if (!t) return ''
        return `<li data-i="${i}">
          ${posterHtml(t, 'w154')}
          <div class="meta">
            <b>${esc(t.title)}</b> <span class="muted">${t.year ?? ''}</span>
            <input class="note" data-i="${i}" maxlength="140" placeholder="One line: why watch it?" value="${esc(li.note)}">
          </div>
          <div class="ord">
            <button data-up="${i}" ${i ? '' : 'disabled'}>↑</button>
            <button data-down="${i}" ${i < l.items.length - 1 ? '' : 'disabled'}>↓</button>
            <button data-rm="${i}">×</button>
          </div>
        </li>`
      })
      .join('')}</ol>
    ${full ? `<p class="muted">Top ${l.topN} is full. Remove one to swap.</p>` : lib.length ? `
      <h3>Add from saved</h3>
      <div class="grid small">${lib
        .slice(0, 24)
        .map((t) => `<button class="tile" data-add="${esc(t.key)}">${posterHtml(t, 'w154')}<span>${esc(t.title)}</span></button>`)
        .join('')}</div>` : '<p class="muted">Collect titles first, then add them here.</p>'}
    <button id="del" class="ghost">Delete list</button>`)

  $('#lname').addEventListener('blur', (e) => {
    l.name = (e.target as HTMLElement).textContent!.trim() || l.name
    save()
  })
  app.querySelectorAll<HTMLInputElement>('.note').forEach((inp) =>
    inp.addEventListener('change', () => {
      l.items[Number(inp.dataset.i)].note = inp.value.trim()
      save()
    }),
  )
  $('main').onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    const d = b.dataset
    const swap = (a: number, c: number) => ([l.items[a], l.items[c]] = [l.items[c], l.items[a]])
    if (d.up) swap(Number(d.up), Number(d.up) - 1)
    else if (d.down) swap(Number(d.down), Number(d.down) + 1)
    else if (d.rm) l.items.splice(Number(d.rm), 1)
    else if (d.add) l.items.push({ key: d.add })
    else if (b.id === 'share') return openFling(l)
    else if (b.id === 'del') {
      state.lists = state.lists.filter((x) => x !== l)
      location.hash = '#/lists'
    } else return
    save()
  }
}

// ---------- the fling stage ----------
async function openFling(l: List) {
  const url = await shareUrl(l, 'fling')
  const cards = l.items
    .map((li, i) => {
      const t = state.library[li.key]
      if (!t) return ''
      const origin = t.recos.find((r) => r.from !== state.me.name)?.from
      return `<div class="hc" style="--i:${i}">${cardHtml({ title: t.title, year: t.year, media: t.media, poster: t.poster, note: li.note, from: state.me.name, origin, rank: l.topN ? i + 1 : undefined, total: l.items.length, rarity: t.recos.length + 1 })}</div>`
    })
    .reverse()
    .join('')
  const myCode = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('')
  const stage = document.createElement('div')
  stage.className = 'stage'
  stage.innerHTML = `
    <div class="stage-top"><span>${esc(l.name)}</span><span>${titles(l.items.length)}</span><button class="x" aria-label="Close">Close</button></div>
    <div class="around">
      <div class="around-head"><span>Around</span><button class="codebtn" data-a="code">Code</button></div>
      <div class="peers" id="peers"></div>
      <div class="codebox" hidden>
        <span>Your code <b>${myCode}</b></span>
        <input id="codeIn" maxlength="4" placeholder="or theirs" autocapitalize="characters" autocomplete="off">
      </div>
    </div>
    <div class="hand" id="deal">${cards}</div>
    <p class="hint" id="hint"></p>
    <div class="stage-acts">
      <button data-a="qr" class="ghost">QR</button>
      <button data-a="copy" class="ghost">Copy link</button>
      ${support.shareFiles() ? '<button data-a="file" class="ghost">Send as file</button>' : ''}
    </div>
    <div class="qr" hidden></div>`
  document.body.append(stage)

  const doShare = () => {
    if (support.share()) {
      navigator
        .share({ title: l.name, text: `${state.me.name} sent you: ${l.name}`, url })
        .then(() => logGateway('web-share', `${l.name} (${url.length} chars)`))
        .catch((err) => logGateway('web-share', err.name === 'AbortError' ? 'cancelled' : err.message, false))
    } else {
      navigator.clipboard?.writeText(url).then(
        () => (toast('Link copied'), logGateway('copy-link', l.name)),
        () => logGateway('copy-link', 'blocked', false),
      )
    }
  }
  const peerBox = $('#peers', stage)
  const hint = $('#hint', stage)
  const howLabel = { network: 'Same wifi', online: 'Online', code: 'Code' } as const
  const drawPeers = (peers: Peer[]) => {
    peerBox.innerHTML = peers.length
      ? peers
          .map((p) => `<button class="peer" data-id="${esc(p.id)}"><span class="av">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="pn">${esc(p.name)}</span><span class="ph">${p.friend ? 'Friend' : howLabel[p.how]}</span></button>`)
          .join('')
      : `<p class="nobody">${relay.status === 'on' ? 'Nobody around yet.' : 'Offline.'} Use QR or Share.</p>`
    hint.textContent = peers.length
      ? peers.length === 1 ? `↑ Flick to ${peers[0].name}` : '↑ Aim and flick toward someone'
      : `↑ ${support.share() ? 'Flick to share' : 'Flick to copy the link'}`
  }
  const unsub = relay.onPeers(drawPeers)
  const peerEls = () => Array.from(stage.querySelectorAll<HTMLElement>('.peer'))
  const hand = $('#deal', stage)

  const sendTo = async (el: HTMLElement) => {
    const peer = relay.peers.find((p) => p.id === el.dataset.id)
    if (!peer) return
    el.classList.add('sending')
    const ok = await relay.send(peer.id, buildPayload(l))
    el.classList.remove('sending', 'aim')
    el.classList.add(ok ? 'sent' : 'failed')
    el.querySelector('.ph')!.textContent = ok ? 'Sent' : 'Missed'
    logGateway('nearby', `${l.name} → ${peer.name} (${peer.how})${ok ? '' : ' · not delivered'}`, ok)
    setTimeout(() => el.classList.remove('sent', 'failed'), 2500)
  }

  attachFling(
    hand,
    (dir: Vec) => {
      const target = pickTarget(hand, peerEls(), dir)
      if (target) sendTo(target)
      else doShare()
    },
    (dir) => {
      const els = peerEls()
      const t = dir ? pickTarget(hand, els, dir) : null
      els.forEach((el) => el.classList.toggle('aim', el === t))
    },
  )

  const close = () => {
    unsub()
    relay.setCode(null)
    stage.remove()
  }

  $('#codeIn', stage).addEventListener('input', (e) => {
    const v = (e.target as HTMLInputElement).value.toUpperCase().replace(/[^A-Z]/g, '')
    ;(e.target as HTMLInputElement).value = v
    if (v.length === 4) {
      relay.setCode(v)
      logGateway('code', `joined ${v}`)
    }
  })

  stage.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    if (b.classList.contains('x')) return close()
    if (b.classList.contains('peer')) return sendTo(b)
    const a = b.dataset.a
    if (a === 'code') {
      const box = $('.codebox', stage)
      box.hidden = !box.hidden
      relay.setCode(box.hidden ? null : myCode)
      if (!box.hidden) logGateway('code', `showing ${myCode}`)
    }
    if (a === 'copy') {
      await navigator.clipboard?.writeText(await shareUrl(l, 'link'))
      toast('Link copied')
      logGateway('copy-link', l.name)
    }
    if (a === 'qr') {
      const box = $('.qr', stage)
      box.hidden = false
      const qrUrl = await shareUrl(l, 'qr')
      box.innerHTML = `<img src="${await qrDataUrl(qrUrl)}" alt="QR code"><p>Scan with the camera. No app needed.</p><button class="ghost" data-a="qrclose">Close</button>`
      logGateway('qr', `${l.name} (${qrUrl.length} chars)`)
    }
    if (a === 'qrclose') $('.qr', stage).hidden = true
    if (a === 'file') {
      const file = payloadFile(buildPayload(l))
      navigator
        .share({ files: [file], title: l.name })
        .then(() => logGateway('web-share-file', file.name))
        .catch((err) => logGateway('web-share-file', err.name === 'AbortError' ? 'cancelled' : err.message, false))
    }
  })
}

// ---------- receiving ----------
async function renderReceivedFromHash(channel: string, data: string) {
  try {
    const p = await decode(data)
    logGateway(`receive:${channel}`, `${p.list.name} from ${p.from}`)
    renderReceived(p, channel)
  } catch {
    logGateway(`receive:${channel}`, 'broken link', false)
    shell('', '<p class="empty">This link looks broken. Ask for it again?</p>')
  }
}

function renderReceived(p: Payload, channel: string) {
  const mine = p.from === state.me.name
  shell('', `
    <section class="received">
      <p class="eyebrow">${esc(p.from)} sent you ${titles(p.items.length)}</p>
      <h2>${esc(p.list.name)}</h2>
      <div class="row-cards" id="incoming">${p.items
        .map((it, i) => `<div class="rc">${cardHtml({ title: it.t, year: it.y, media: it.m, poster: it.p, note: it.n, from: p.from, origin: it.o, rank: p.list.topN ? i + 1 : undefined, total: p.items.length, rarity: it.o ? 2 : 1 })}</div>`)
        .join('')}</div>
      ${mine ? '<p class="muted">Your own list. This is what your friends see.</p>' : ''}
      <button id="keep" class="big wide">${p.items.length === 1 ? 'Save' : `Save all ${pad(p.items.length)}`}</button>
      <p class="muted">Every card stays signed by ${esc(p.from)}.</p>
    </section>`)
  app.querySelectorAll<HTMLElement>('#incoming .rc').forEach((el, i) => setTimeout(() => flyIn(el), i * 90))
  $('#keep').addEventListener('click', () => {
    if (!state.me.name) {
      const n = prompt('Your first name?')?.trim()
      if (!n) return
      state.me.name = n
    }
    keepPayload(p, channel)
    location.hash = `#/inbox/${encodeURIComponent(p.from)}`
  })
}

/** Save a received list: every title keeps who it's from, the sender becomes a friend. */
function keepPayload(p: Payload, channel: string, ref = '') {
  const list: List = { id: uid(), name: p.list.name, topN: p.list.topN, items: [], createdAt: now(), from: p.from }
  const single = !!p.list.single || p.items.length === 1
  for (const it of p.items) {
    const item = addToLibrary(
      { title: it.t, year: it.y, media: it.m, tmdbId: it.i, imdbId: it.im, poster: it.p, resolved: !!it.i },
      `received:${channel}`,
      { from: p.from, origin: it.o, note: it.n, at: now(), channel },
    )
    list.items.push({ key: item.key, note: it.n })
  }
  // a single title goes straight to Saved; only real lists show up under Lists
  if (!single) state.lists.unshift(list)
  save()
  logGateway('keep', `${p.items.length} titles from ${p.from}`)
  if (p.fid && p.fid !== state.me.id) {
    addFriend(p.fid, p.from)
    relay.ack(p.fid, ref, true) // tells the sender, who adds us back
  }
}

// ---------- incoming over the air ----------
function showIncoming(m: IncomingHand) {
  const p = m.payload
  if (!p || p.v !== 1 || !Array.isArray(p.items)) return
  p.from = m.from.name
  p.fid = m.from.id
  const friend = !!state.friends[m.from.id]
  if (friend) keepPayload(p, 'nearby', m.ref)
  document.querySelector('.incoming-ov')?.remove()
  const ov = document.createElement('div')
  ov.className = 'stage incoming-ov'
  ov.innerHTML = `
    <div class="stage-top"><span>From ${esc(m.from.name)}</span><span>${titles(p.items.length)}</span><button class="x">Close</button></div>
    <div class="ov-body">
      <p class="eyebrow">${esc(m.from.name)} sent you</p>
      <h2>${esc(p.list.name)}</h2>
      <div class="row-cards">${p.items
        .map((it, i) => `<div class="rc">${cardHtml({ title: it.t, year: it.y, media: it.m, poster: it.p, note: it.n, from: m.from.name, origin: it.o, rank: p.list.topN ? i + 1 : undefined, total: p.items.length, rarity: it.o ? 2 : 1 })}</div>`)
        .join('')}</div>
      ${friend
        ? `<p class="muted">Saved.</p><button class="big wide" data-a="open">Open saved</button>`
        : `<div class="row"><button class="big" data-a="keep">${p.items.length === 1 ? 'Save' : 'Save all'}</button><button class="ghost big" data-a="decline">Decline</button></div><p class="muted">Saving makes ${esc(m.from.name)} a friend: next time, titles arrive directly.</p>`}
    </div>`
  document.body.append(ov)
  ov.querySelectorAll<HTMLElement>('.rc').forEach((el, i) => setTimeout(() => flyIn(el), i * 90))
  logGateway('nearby-in', `${p.list.name} from ${m.from.name}${friend ? ' · auto-kept' : ''}`)
  ov.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    const a = b.dataset.a
    if (a === 'keep') {
      keepPayload(p, 'nearby', m.ref)
      toast(`Saved · ${m.from.name} is now a friend`)
    }
    if (a === 'decline') relay.ack(m.from.id, m.ref, false)
    if (a === 'open' || a === 'keep') location.hash = `#/inbox/${encodeURIComponent(m.from.name)}`
    ov.remove()
    render()
  })
}

relay.onHand(showIncoming)
relay.onAck(({ from, kept }) => {
  if (kept) {
    addFriend(from.id, from.name)
    toast(`${from.name} saved your list`)
  } else toast(`${from.name} declined`)
  logGateway('ack', `${from.name} ${kept ? 'kept' : 'declined'}`)
})

// ---------- gateways (diagnostics + settings) ----------
function renderGateways() {
  const row = (label: string, ok: boolean, note = '') =>
    `<tr><td>${label}</td><td class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '—'}</td><td class="muted">${note}</td></tr>`
  const ios = support.ios(), android = support.android()
  shell('gateways', `
    <section class="card">
      <h3>This device</h3>
      <table class="gw">
        ${row('Installed (home screen)', support.standalone(), ios ? 'Safari → Share → Add to Home Screen' : 'Browser menu → Install app')}
        ${row('Offline cache', support.sw(), 'reload once after first visit')}
        ${row('Web Share · link', support.share(), ios ? 'opens iOS sheet: AirDrop, Messages…' : '')}
        ${row('Web Share · file', support.shareFiles(), 'sends a .recco.json')}
        ${row('Share target (receive)', android && support.standalone(), android ? 'appears in Android share sheet once installed' : 'Android only')}
        ${row('Clipboard read', support.clipboardRead(), ios ? 'iOS asks each time' : '')}
        ${row('Compressed links', support.compression(), 'shorter links & QR')}
        ${row('TMDB search', hasTmdb(), hasTmdb() ? '' : 'add a key below')}
        ${row('Relay (nearby)', relay.status === 'on', relay.status === 'on' ? `${relay.peers.length} around · network ${relay.net || '…'} (same wifi = same 4 characters)` : 'not connected')}
      </table>
    </section>

    <section class="card">
      <h3>Settings</h3>
      <form id="settings">
        <label>Your name<input name="name" value="${esc(state.me.name)}"></label>
        <label>Visible on the same wifi to
          <select name="visible">
            <option value="network" ${state.visible === 'network' ? 'selected' : ''}>Anyone with the app</option>
            <option value="friends" ${state.visible === 'friends' ? 'selected' : ''}>Friends only</option>
          </select></label>
        <label>Relay URL <input name="relay" value="${esc(state.relayUrl)}" placeholder="default: ws://${esc(location.hostname)}:8787" autocomplete="off"></label>
        <label>TMDB API key or read access token
          <input name="tmdb" value="${esc(state.tmdbToken)}" placeholder="themoviedb.org → Settings → API" autocomplete="off"></label>
        <button>Save</button>
      </form>
      <p class="muted small">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    </section>

    <section class="card">
      <h3>Friends</h3>
      ${Object.keys(state.friends).length
        ? `<ul class="ways">${Object.entries(state.friends).map(([, f]) => `<li>${esc(f.name)} <span class="muted">since ${new Date(f.since).toLocaleDateString()}</span></li>`).join('')}</ul>`
        : '<p class="muted">Save a list from someone and they become a friend. Lists from friends arrive directly, no accept.</p>'}
    </section>

    <section class="card">
      <h3>Try a gateway</h3>
      <div class="row wrap">
        <button class="ghost" data-t="demo">Receive a demo list</button>
        <button class="ghost" data-t="st">Simulate share-target</button>
        <button class="ghost" data-t="reset">Reset all data</button>
      </div>
    </section>

    <section class="card">
      <h3>Gateway log</h3>
      ${state.log.length ? `<ul class="log">${state.log
        .map((l) => `<li class="${l.ok ? '' : 'bad'}"><time>${new Date(l.at).toLocaleTimeString()}</time><b>${esc(l.gateway)}</b> ${esc(l.detail)}</li>`)
        .join('')}</ul>` : '<p class="muted">Every share and collect event shows up here — handy when testing on several phones.</p>'}
    </section>`)

  $('#settings').addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(e.target as HTMLFormElement)
    state.me.name = String(fd.get('name')).trim()
    state.tmdbToken = String(fd.get('tmdb')).trim()
    state.visible = fd.get('visible') === 'friends' ? 'friends' : 'network'
    const newRelay = String(fd.get('relay') || '').trim()
    const relayChanged = newRelay !== state.relayUrl
    state.relayUrl = newRelay
    save()
    relay.update()
    if (relayChanged) location.reload()
    toast('Saved')
  })
  app.querySelector('.row.wrap')!.addEventListener('click', async (e) => {
    const t = (e.target as HTMLElement).dataset.t
    if (t === 'demo') {
      const demo: Payload = {
        v: 1,
        from: 'Léa',
        list: { name: 'My Top 5 of 2026', topN: 5 },
        items: [
          { t: 'Past Lives', y: 2023, n: 'Watch it alone, late.' },
          { t: 'Anatomy of a Fall', y: 2023, n: 'The dog deserves the Palme.' },
          { t: 'Perfect Days', y: 2023, n: 'Slow, then it gets you.' },
          { t: 'Shōgun', y: 2024, m: 'tv', n: 'Ten episodes, zero filler.', o: 'Karim' },
          { t: 'Aftersun', y: 2022, n: 'Bring tissues.' },
        ],
      }
      location.hash = `#/r/demo/${await encode(demo)}`
    }
    if (t === 'st') location.href = `${location.pathname}?title=Letterboxd&text=${encodeURIComponent('Past Lives (2023) on Letterboxd')}&url=${encodeURIComponent('https://letterboxd.com/film/past-lives/')}`
    if (t === 'reset' && confirm('Delete everything on this device?')) {
      localStorage.clear()
      location.href = location.pathname
    }
  })
}

// ---------- router ----------
async function render() {
  if (state.me.name) relay.connect()
  const [screen, a, b] = route()
  if (screen === 'r' && a && b) return renderReceivedFromHash(a, b)
  if (needName()) return
  if (screen === 'lists') return renderLists()
  if (screen === 'list' && a) return renderList(a)
  if (screen === 't' && a) return renderTitle(decodeURIComponent(a))
  if (screen === 'inbox') return renderInbox()
  if (screen === 'gateways') return renderGateways()
  return renderCollect()
}

// Re-render on data change, except while a receive screen or the fling stage is open
onChange(() => {
  const r = route()[0]
  // the title page re-renders itself; re-rendering on its note's blur would swallow the Send tap
  if (r === 'r' || r === 't' || r === 'collect' || r === '' || document.querySelector('.stage')) return
  const focused = document.activeElement as HTMLElement | null
  if (focused?.matches('input, textarea, [contenteditable]')) return
  render()
})
window.addEventListener('hashchange', render)
handleIncoming().then(render)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {})
}
