# App options — connecting people

Principle: **stay a web app as long as possible**, and stack low-tech tricks so two people can exchange a list in **less than one click**, wherever they meet: street, café, dinner party, no network.

Discovery (who is near me) and delivery (getting ~300 bytes to them) are separate problems. A list is tiny, so delivery is easy; finding the right person is the real design work.

---

## 1. The two situations

### A. The other person doesn't have the app

1. Sender taps **Send**. Nobody around → the QR code is already on screen.
2. Receiver scans with the phone camera → the list opens **instantly** in the browser. No install, no account.
3. Under the cards: **Keep these cards** → install (Android prompt / iOS "Add to Home Screen" guide).
4. First launch: the list is already in their saved titles, signed by the sender, and the two are **friends**.

One QR = delivery + invite + friend pairing.

> iOS trap: a home-screen app does not share storage with Safari. Store the list server-side behind a short claim code so the installed app picks it up on first launch.

### B. Both have the app

1. Sender taps **Send** → the **Around** row shows friends first, then people nearby.
2. Flick toward an avatar.
3. Receiver gets "Léa wants to send you 5 cards" → accept → cards drop in.

- **Friend**: can receive with the app closed (Web Push, works on iOS for installed web apps).
- **Stranger**: must have the app open. Opening the app = visible for 60 s, no extra tap.

### The Send screen

```
AROUND      [Tom ✓ friend]  [Karim ✓ friend]  [Léa · same wifi]
NOT ON IT?  [ QR ]          invite + send at once
ELSEWHERE   [ Share ]       AirDrop, Messages, WhatsApp…
```

---

## 2. The tricks — ranked by clicks

Clicks are counted after the Send screen is open. "0" means the gesture itself (flick, scan, tap phone) is the action.

| # | Trick | Sender | Receiver | Internet | Server | Receiver needs app | Works on | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | **List inside the link** | — | — | no* | no | no | all | done |
| 2 | **QR on screen** | 0 | 0 (camera) | no* | no | no | all | done |
| 3 | **Same Wi-Fi auto-discovery** | 0 (flick) | 1 (accept) | yes | yes | yes | all | M |
| 4 | **Friends, recognised** | 0 (flick) | 0–1 | yes | yes | yes | all | M |
| 5 | **Bump** (flick at the same time) | 0 | 0 | yes | yes | yes | all (iOS asks motion once) | M |
| 6 | **4-letter room code** | 0 | 4 letters | yes | yes | yes | all | S |
| 7 | **Audio chirp** (short code over sound) | 0 | 0 (mic) | yes | yes | yes | all (mic permission) | M |
| 8 | **Link preview** in Messages/WhatsApp | 1 (share) | 0 to see | yes | yes | no | all | S |
| 9 | **Share sheet** (AirDrop, Quick Share…) | 1–2 | 1 | depends | no | no | all | done |
| 10 | **NFC card / sticker** ("my deck") | 0 | 0 (tap phone) | yes | yes | no | read: all recent phones; write: Android Chrome | S |
| 11 | **Printed QR** (card, sticker, coaster) | 0 | 0 (camera) | yes | yes | no | all | S |
| 12 | **Reverse QR** (receiver shows, sender scans) | 1 | 0 | no* | no | yes | all | S |
| 13 | **Geohash room** ("this café, now") | 0 | 0 | yes | yes | yes | all (location permission) | M |
| 14 | **Bluetooth mesh** (bitchat-style) | 0 | 0–1 | **no** | no | yes, **native** | iOS, Android | L |

\* The payload travels in the URL, so an **installed** app can open it fully offline. Someone without the app needs internet to load the page the first time.

### Notes per trick

1. **List inside the link** — compressed JSON in the URL hash. No backend, works offline once installed. Already in the test app.
2. **QR on screen** — the universal fallback. Shows by default when nobody is around.
3. **Same Wi-Fi** — the PairDrop/Snapdrop approach: devices on the same public IP join a room on the server; WebRTC sends the list peer-to-peer so it never touches the server. Perfect at dinner. In a café, strangers share the IP → show first name + initial only, and require accept.
4. **Friends** — once paired (via any QR), keep the friend's public key locally. They appear first in Around as soon as both are online, wherever they are.
5. **Bump** — both flick at the same moment; server matches pairs by timestamp (±500 ms) and rough location. The street solution, and it *is* the fling gesture. iOS needs one tap to allow motion sensors.
6. **Room code** — "KRPL", said out loud. Most reliable among strangers in noise-free settings.
7. **Audio chirp** — sender's phone plays a short tone sequence encoding a 4–6 character code; receiver's mic decodes it (e.g. the ggwave library, which runs in the browser). Bad in loud cafés, magic at a quiet table. Too slow to send the whole list, so it carries a code and the server does the rest.
8. **Link preview** — put the list id in the path (not the hash) so the server can render an Open Graph image of the cards. In Messages/WhatsApp the receiver *sees* the list before clicking anything.
9. **Share sheet** — Web Share API. On iPhone this is the only way to reach AirDrop; on Android, Quick Share.
10. **NFC card** — an NFC sticker on a physical trading card or coaster holds a static link to *your* latest list ("tap my card"). iPhones read NFC links natively without any app; writing tags from the web works in Chrome on Android. Great branded object for a dinner table.
11. **Printed QR** — the same idea without NFC: on a business card, a sticker, a menu. Static URL → always your current list.
12. **Reverse QR** — the receiver shows "my QR" and the sender scans it: useful to add a friend, or when the sender's screen is far away.
13. **Geohash room** — like bitchat's location channels: people with the app open within ~100 m and the same 10-minute window see each other. Opt-in only.
14. **Bluetooth mesh** — the only option that works with **no network at all** between two people who don't already have each other's QR. Requires a native wrapper (Capacitor) + a Bluetooth layer; bitchat's is public domain (Unlicense) and can be reused. Web browsers cannot do this: Safari has no Web Bluetooth, Chrome cannot advertise.

---

## 3. Coverage by place

| Place | Best combo |
|---|---|
| **Dinner party** | Same Wi-Fi (3) + friends (4) + QR (2) + NFC coaster (10) |
| **Café** | Room code (6) or bump (5) + QR (2); same Wi-Fi only with accept |
| **Street** | Bump (5) + QR (2) + geohash (13) |
| **No network** | QR between installed apps (2) · reverse QR (12) · Bluetooth (14, native only) |
| **Far away** | Share sheet (9) + link preview (8) |

The Send screen turns on **every channel the device allows at once** and merges results into one Around row, each avatar tagged with how it was found. Delivery uses the best available path: peer-to-peer → server → link/QR → queue and retry later.

---

## 4. Privacy rules

- Visible only while Send or Receive is open, **60 s max**.
- Strangers see a **first name + initial**, never a profile or a stable id.
- Use **rotating anonymous ids** for discovery; reveal the name only after both sides connect.
- Receiving always needs **accept** from a non-friend. Nobody gets cards they didn't agree to.
- Prefer peer-to-peer delivery (WebRTC) so lists don't sit on the server.
- Default: **friends + QR only**. Open discovery of strangers (Wi-Fi, bump, geohash) is opt-in.

---

## 5. Build order

| Phase | Adds | Stack |
|---|---|---|
| **0 — now** | List in link, QR, share sheet | Web app, no backend (done) |
| **1** | Claim codes (iOS install trap), link preview, room code, friends + Web Push | Small realtime server (Supabase or Node WebSocket) + OG images |
| **2** | Same Wi-Fi + WebRTC, bump, reverse QR | Same server |
| **3** | NFC cards, printed QR, audio chirp, geohash rooms | Same server |
| **4 — only if needed** | Bluetooth offline | Capacitor wrapper + bitchat's BLE layer |

Rule: a trick graduates to the main Send screen only if it works in **less than one click** for both people.

---

Reference: bitchat — Bluetooth mesh, up to 7 hops, Nostr fallback, public domain — https://github.com/permissionlesstech/bitchat
