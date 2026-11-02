# Stack and tools

## Overview

| Layer | Choice | Why |
|---|---|---|
| iOS app | SwiftUI (iOS 17+) | The fling + nearby send need native APIs; SwiftUI makes the card physics easy. |
| Nearby send | MultipeerConnectivity | Phone-to-phone over Bluetooth/peer Wi-Fi, no internet needed. |
| Pointing (optional) | NearbyInteraction (UWB) | iPhone 11+ — aim at a phone to pick the receiver. Graceful fallback to avatar list. |
| Save from other apps | Share Extension | Receive URLs from Safari, Letterboxd, IMDb, Messages. |
| Non-user receive | App Clip + web page | QR → instant view without install. |
| Film data | TMDB API v3 | Free, films + series, posters, `find` by IMDb ID, watch providers (JustWatch data). |
| Backend | Supabase | Auth (Sign in with Apple), Postgres, Row Level Security, Realtime, Edge Functions. |
| Web | Nuxt 4 or Next.js on Vercel | Public list pages `recco.app/l/<id>`, Universal Links, OG images. |
| Push | APNs via Supabase Edge Function | "Tom watched your pick". |
| Local storage | SwiftData | Offline-first cache; sync to Supabase. |

## Data sources

- **TMDB** — primary. Requires attribution ("This product uses the TMDB API but is not endorsed or certified by TMDB") and logo in About screen.
  - `GET /search/multi?query=` — search films + series.
  - `GET /find/{imdb_id}?external_source=imdb_id` — IMDb ID → TMDB.
  - `GET /movie/{id}/watch/providers`, `/tv/{id}/watch/providers` — where to stream (FR).
- **IMDb** — no public API. Use: link parsing (`tt\d+` in URL) and CSV import from the user's own export.
- **Letterboxd** — API is invite-only. Use: CSV export import (watchlist.csv, lists/*.csv, ratings.csv) and link resolution. Film pages expose TMDB/IMDb IDs in their links; resolve server-side in an Edge Function, cache the slug → TMDB mapping. Respect robots/ToS: resolve single URLs the user shares, never crawl.
- **JustWatch, SensCritique, Allociné, Trakt** — link parsing where an ID is in the URL; Trakt has a public API if needed later.

## Link resolver (Edge Function)

```
POST /resolve { url }
  imdb.com/title/ttXXXX        → TMDB find
  themoviedb.org/movie|tv/ID   → direct
  letterboxd.com/film/slug     → cache lookup → fetch page once → TMDB id → cache
  boxd.it/xxxx                 → follow redirect → letterboxd rule
  fallback                     → page <title> → TMDB search, ask user to confirm
```

## The fling (implementation notes)

- `DragGesture` on the card, track velocity; on release with `velocity.y < -1200` and an aim target → send.
- Spring animation off-screen in the direction of the flick; haptic `.impact(.heavy)` on release, `.success` on delivery ack.
- Receiver: card enters from the top edge with matching spring, slight rotation, then settles into an "inbox" stack.
- Payload over Multipeer: a small JSON (`list_id`, title IDs, notes, sender profile). Full data fetched from Supabase when online; payload alone is enough to render offline.

## Dev tooling

- Xcode 16+, Swift 6, Swift Package Manager.
- Supabase CLI for local DB + migrations (`supabase/migrations`).
- GitHub Actions: SwiftLint + unit tests on PR; Xcode Cloud or Fastlane for TestFlight.
- Costs at MVP: Apple Developer 99 €/yr, Supabase free tier, Vercel hobby, TMDB free.

## Open questions

- Android at some point? If yes early, consider React Native/Expo and accept a less native fling (Nearby Connections API on Android).
- Name and domain: check `recco.app` / `recco.fr` availability and App Store name.
