# Recco

Share film and series recommendations like objects: build a list, fling it to a friend's phone, and the author tag stays attached forever.

> Working name: Recco (may still change). It lives in one place: `web/src/config.ts`, plus the manifest and `index.html`.

## Folder

```
recco/
├── README.md                 ← this file
├── docs/
│   ├── user-stories.md       ← personas, stories, acceptance criteria
│   ├── app_options.md        ← ways to connect people: tricks, click budget, privacy, build order
│   ├── stack.md              ← tools, APIs, why each one
│   └── roadmap.md            ← MVP → v1 → later
├── web/                      ← installable test web app (PWA) — start here
│   └── README.md             ← run, deploy, gateways under test
├── supabase/
│   └── migrations/
│       └── 0001_init.sql     ← Postgres schema + RLS
```

## The one-line pitch

Letterboxd logs what you watched. Recco passes on what someone should watch, and remembers who told them.
