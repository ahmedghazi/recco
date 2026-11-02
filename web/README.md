# Recco — test web app (PWA)

An installable web app for testing the collect and share gateways before building anything native. No backend: data lives on the device, and shared lists travel inside the link.

Design: Swiss, black and white, one typeface (IBM Plex Mono, bundled so it works offline). Each title is shown as a card; a list is a small stack you send.

The name is a placeholder. Change it in `src/config.ts`, `public/manifest.webmanifest` and `index.html`.

## Run

```bash
pnpm install
pnpm dev           # relay on :8787 + app on http://localhost:5173 (and your LAN)
pnpm build         # → dist/
```

## Nearby: send to a friend around you

Open a list → **Send**. The **Around** row shows who you can send to:

- **Friends**, wherever they are, as long as their app is open.
- **People on the same wifi** with the app open (setting: *anyone* or *friends only*).
- **Code**: tap *Code*, read your 4 letters out loud, the other person types them. For cafés.

Aim the list toward someone and flick: it lands on their screen. One person around → any flick goes to them. Tapping an avatar works too.

- A **friend** receives directly: cards fly in, already in the saved titles.
- A **stranger** sees *Save all / Decline*. Saving makes you friends both ways, so the next send lands directly.
- Nobody around → the flick falls back to the share sheet, QR and link still work.

This needs the small relay in `server/relay.mjs` (Node + `ws`, no database, nothing stored). It groups people by public IP (or /24 on a local network), friends, and codes, and forwards lists.

### Deploying the relay

Vercel can't host WebSockets, so the relay runs elsewhere (Render, Fly.io, Railway — any Node host):

- start command: `node server/relay.mjs` (listens on `PORT`)
- then set `VITE_RELAY_URL=wss://your-relay.example.com` in the Vercel project env and redeploy.

Testers can also paste a relay URL in *Gateways → Settings*.

On a LAN during `pnpm dev`, phones connect to `ws://<your-mac-ip>:8787` automatically. Note that phones need HTTPS to install the app, but plain-HTTP LAN works for testing discovery and sending in the browser.

Phones need **HTTPS** to install the app and use Web Share. To test on real phones, deploy:

- **Vercel**: `npx vercel` (vercel.json included), or import the GitHub repo.
- **GitHub Pages**: push `dist/` (the build uses relative paths, so a sub-path works).

Then open it on each phone:
- **iPhone**: Safari → Share → *Add to Home Screen*
- **Android**: Chrome → ⋮ → *Install app*

## Gateways under test

| Gateway | Direction | Works on | Notes |
|---|---|---|---|
| TMDB search | collect | all | Add a TMDB key in *Gateways → Settings* (free at themoviedb.org). |
| Paste a link / text | collect | all | IMDb, Letterboxd (incl. user review URLs), TMDB, Trakt, SensCritique, JustWatch, or "Title (2024)". |
| Clipboard button | collect | all (iOS asks) | |
| Share target | collect | **Android, installed** | Appears as "Recco" in the system share sheet. iOS doesn't support this for web apps. |
| iOS Shortcut | collect | iPhone | Shortcut "Open URL": `https://<your-domain>/?add=[Shortcut Input]`, shown in the share sheet. |
| Bookmarklet | collect | desktop | On the Collect screen. |
| CSV import | collect | all | Letterboxd `watchlist.csv` / `ratings.csv`, IMDb export. |
| **Fling** → Web Share | share | iOS, Android, Safari macOS | Flick the card up → system share sheet (AirDrop, Messages, WhatsApp…). Falls back to copying the link. |
| QR for the table | share | all | Friends scan with their camera, no install needed. |
| Copy link | share | all | |
| Send as file | share | where file sharing works | `.recco.json`; open with *Collect → Open a shared list file*, or double-click on desktop once installed (file handler). |
| Receive link | receive | all | Cards fly in; *Save all* keeps "from <name>" and notes on every title. |
| **Nearby flick** | share | all, app open on both | Same wifi, friends, or 4-letter code via the relay. Aim + flick. |

The *Gateways* tab shows what the current device supports, and a log of every share and collect event. That's handy when testing with several phones.

## Without a TMDB key

Everything still works. Titles stay "unresolved", with a generated poster, and keep their link. Add a key to get real posters, search, and IMDb/Letterboxd → TMDB matching.

## Known limits of the web version

- Nearby needs internet on both phones (it goes through the relay). Fully offline sharing needs a native Bluetooth layer, see `../docs/app_options.md`.
- A web app can't run in the background: the receiver has to have the app open. Web Push for friends is the next step.
- `boxd.it` short links can't be followed from the browser (CORS). The title is taken from the shared text instead. A small server function would fix this.
- No accounts, so there are no "Tom watched your pick" pings yet. The app shows a toast where the ping would go.
