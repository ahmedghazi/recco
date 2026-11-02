# User stories

## Personas

- **Léa, the curator.** Watches a lot, has opinions, gets asked "what should I watch?" at every dinner.
- **Tom, the receiver.** Watches a bit, forgets every recommendation by the next morning.
- **The table.** 4–8 friends at a dinner party, mixed: some have the app, most don't.

## Core flow: the dinner party Top 5

```
Collect  →  Curate  →  Share at the table  →  Lands with author  →  Close the loop
```

---

### 1. Collect

**As Léa, I want to save a film in two taps when someone mentions it, so I stop losing recommendations.**

- Search by title (TMDB), films and series together.
- Share Sheet: share an IMDb / Letterboxd / TMDB / JustWatch link from any app into Recco → resolved to a title.
- Import a Letterboxd or IMDb CSV export (watchlist, lists, ratings).
- Each saved title can keep "who told me" (free text or a Recco friend) — attribution starts at collection, not only at sharing.

Acceptance
- [ ] Pasting `letterboxd.com/film/<slug>/` or `imdb.com/title/tt…` resolves to the right TMDB title in < 2 s.
- [ ] Duplicate saves merge; they never create two entries.
- [ ] Works offline; syncs later.

### 2. Curate

**As Léa, I want to build "My Top 5 of 2026" with an order and a one-line note per film, so the list says something about me.**

- Lists: name, optional cover (auto-collage of posters), ordered items.
- Per-item note (≤ 140 chars), e.g. "watch it alone, late".
- Templates: *Top 5 of the year*, *For a rainy Sunday*, *Series to binge*.
- Drag to reorder.

Acceptance
- [ ] A Top N list caps at N and shows ranks.
- [ ] Notes show on the shared card, not hidden behind a tap.

### 3. Share at the table

**As Léa, I want to drag my list and flick it towards a friend's phone, so sharing feels like handing over a physical card.**

- Long-press a list → it lifts as a card → flick toward a nearby phone.
- Nearby receivers show as avatars at the top edge (MultipeerConnectivity); on UWB iPhones, pointing selects the phone (NearbyInteraction).
- Receiver sees the card fly in from the edge, with haptics.
- **Non-users:** the card flips to a QR code. Scan → web page with the list + App Clip / install link. No account needed to view.
- Fallback: system Share Sheet (link) for remote friends.

Acceptance
- [ ] Two phones on the same table, no Wi-Fi: send works.
- [ ] A non-user can see the full list within 5 s of scanning.
- [ ] Sending to 5 people at once works (broadcast mode: "send to the table").

### 4. Keep the author

**As Tom, I want each film I receive to stay tagged "from Léa" with her note, so I remember why I should watch it.**

- Every received title creates a `Recommendation` (sender, note, source list, date).
- Same film recommended by 3 people → one title, 3 stacked attributions ("Léa, Karim and 1 other").
- Filter my watchlist by who recommended.
- Forwarding keeps the chain: "from Karim, via Léa".

Acceptance
- [ ] Attribution survives edits, re-saves and forwarding.
- [ ] Deleting my account anonymises my sent recommendations ("from a friend"), it does not erase them from others.

### 5. Close the loop

**As Léa, I want a ping when Tom watches and rates something I recommended, so I know the advice landed.**

- Tom marks "watched" + optional rating/reaction.
- Léa gets a notification and a "hit rate" on her profile (x of y recommendations watched, avg rating).
- Optional: Tom can reply to the note.

Acceptance
- [ ] Notifications can be muted per friend.
- [ ] Hit rate only counts recommendations the receiver has acted on.

---

## Secondary stories (post-MVP)

- Where to watch: streaming providers per country (TMDB watch providers, FR default).
- Group pick: at the end of dinner, everyone's lists merge into "what the table recommends".
- Export back to Letterboxd CSV.
- Year-end recap: "you sent 42 films, 18 were watched".
