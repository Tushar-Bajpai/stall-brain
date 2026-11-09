# Bazaar Brain — Implementation Plan (v1)

> **Product:** Bazaar Brain — agentic daily procurement advisor for street vendors
> **Current repo:** `C:\Users\ASUS\OneDrive\Documents\Bazaar-Brain\stall-brain`
> **Locked decisions:** Supabase as the single backend (Postgres, Auth, Realtime, Storage, Edge
> Functions) · No WhatsApp/Telegram in any phase (parked indefinitely) · Vendor network starts
> "posts-first" (surplus/need board, same-day expiry) · Offline-first PWA · English + Hindi copy
> stays mandatory in all user-facing builds.

---

## 0. Guiding architecture

```
React 19 + Vite PWA  ──►  Supabase (Auth, Postgres+RLS, Realtime, Storage, Edge Functions)
   │                              │
   │ multiplier engine (local, offline-capable)          Edge Function 'forecast' → Groq API
   │ Dexie (IndexedDB) = offline cache + sync queue       Edge Function 'push' → Web Push (VAPID)
   └ Free services only: Supabase free tier, Open-Meteo, Web Push, FCM-less web push
```

Environment contract (never let any secret be bundled into the client):

| Env var | Where it lives |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | client (safe by design) |
| `GROQ_API_KEY` | Supabase Edge Function secrets **only** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | public one → client; private one → Edge Function secrets |
| `VITE_FIREBASE_*` | removed after Phase 1 migration |

---

## Phase 0 — Fixes & Bugs (no new features, no new infrastructure)

Goal: the existing app becomes correct and honest before anything is added.

### 0.1 Remove the client-exposed Groq key (FIX-2)
- `src/utils/groqAgent.js:62` bundles `VITE_GROQ_API_KEY` into shipped JS.
- Interim step inside Phase 0: create a tiny Supabase project + one Edge Function `forecast`
  that wraps the existing prompt and returns the same `ForecastResult` JSON; keep the client
  contract identical (same request shape, same response, same error codes).
- Full Supabase wiring is Phase 1, but this Edge Function must exist first because every later
  phase depends on the proxy shape.
- Delete `VITE_GROQ_API_KEY` from `.env` and from Vercel env vars.

### 0.2 Live event calendar (FIX-1)
- `src/data/events.js` ends Dec 25, 2025 → multiplier is always 1 today.
- Replace with a runtime "event core":
  1. National holidays: `date-holidays` npm package (offline, free) filtered to India/UP, or
     Calendarific free-tier fetch with a 90-day localStorage cache.
  2. Keep `weeklyPattern` as-is, moved into a `market_defaults.js`.
  3. Keep an editable `market_seeds.js` for city-specific events (Lucknow Mahotsav, IPL home
     fixtures added per season).
- Merge logic stays `Math.max(impactMultiplier)` for same-day events; add a small unit test.

### 0.3 Per-user, server-side profile & history (FIX-3)
- Currently localStorage-only (`bazaarBrain_profile`, `bazaarBrainHistory`) → shared between
  users on one device, lost on browser clear, not portable.
- Phase 0 version: keep localStorage as offline cache but make it keyed `bb_profile_<uid>`,
  `bb_history_<uid>` so two users on one device never collide. Server persistence happens in
  Phase 1 — do not block Phase 0 on Supabase auth migration.

### 0.4 Feedback honesty (FIX-4) + Feedback orphaning (FIX-7)
- `FeedbackBar.jsx` promises "We'll improve tomorrow's forecast" — nothing in code does that.
- Phase 0: change copy to "Noted — saved to your history" (no learning promise yet).
- `ForecastPage.jsx:352-355`: regenerating a same-day forecast deletes the earlier entry and the
  stored feedback. Fix: update the existing same-day entry instead of filter+replace; carry
  `currentHistoryId` across regenerate.

### 0.5 History integrity (FIX-5)
- Raise the cap from 5 → 50 entries.
- Persist the **full** `ForecastResult` (esp. `procurementList`) in each history entry, alongside
  the existing snapshot fields.

### 0.6 Neutral weather failure (FIX-6)
- `ForecastPage.jsx` fallback currently fabricates "Clear & Sunny, 32°C, 1.2×".
- Change to: `footfallImpact: 1`, label "Weather unavailable", recommendation neutral, and a
  visible "approximate plan" badge in `SignalPanel`.

### 0.7 Weather freshness (FIX-8) + date rollover (FIX-9)
- Re-fetch weather on `visibilitychange`→visible and every 30 min (no new dependency).
- Replace `useMemo(() => getTodayInfo(), [])` with state refreshed by a minute-level tick.

### 0.8 Numeric LLM output + arithmetic validation (FIX-10)
- Prompt schema: make `totalNeeded`, `alreadyHave`, `toBuy` **numbers**, keep `unit` separate.
- Client validates `toBuy ≈ max(0, totalNeeded − alreadyHave)` within tolerance; on failure,
  compute the value deterministically and keep the LLM only for summary/notes/priority.
- Drop temperature to 0.2 and cache the day's forecast in `sessionStorage` to prevent
  inconsistent repeats within the same day.

### 0.9 Cleanup (FIX-11..15)
- Delete `src/pages/SetupPage.jsx` + `src/utils/selectionStorage.js` (dead code; `/setup` route
  already redirects). Remove route from `App.jsx`.
- Remove artificial `LOADING_DURATION = 3200` (`ForecastPage.jsx:30`); keep a skeleton-UI
  minimum of ~400 ms only if visual flashing occurs.
- Hoist `RequireAuth` out of the `App` component body (`App.jsx:27`) — it currently remounts
  children on every App re-render.
- README: fix clone URL, add `.env.example`, sync the file-tree section with reality.

**Phase-0 done when:** a fresh user can run a forecast with zero Groq key in the bundle; events
fire for at least one upcoming real date; feedback survives regenerate; history stores full
results; `npm run build` + `npm run lint` pass.

---

## Phase 1 — Supabase migration (auth + server-side data)

Goal: one identity system, server-persisted per-user data, Edge Function in production.

### 1.1 Supabase project & schema
Tables (DDL sketch):

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  stall_type text not null,
  stall_label text not null,
  stall_emoji text not null,
  ingredients text[] not null default '{}',
  prices jsonb,                       -- { item: { buy_price, sell_price } } (nullable)
  market_slug text not null default 'hazratganj',
  created_at timestamptz not null default now()
);

create table forecasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fdate date not null,
  stall_type text not null,
  expected_customers int,
  demand_multiplier numeric,
  result jsonb not null,             -- full ForecastResult
  inventory_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, fdate)            -- one forecast per day; regenerate = update
);

create table daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  forecast_id uuid references forecasts(id) on delete set null,
  fdate date not null,
  item_label text not null,
  unit text not null,
  predicted numeric,
  actual_sold numeric,
  actual_left numeric,
  created_at timestamptz not null default now()
);
```

RLS on every table: `auth.uid() = user_id` (profiles: `auth.uid() = id`). Each vendor sees only
their own rows — enforced by the database, not the UI.

### 1.2 Auth migration
- Enable Supabase Auth: **email + password first** (free), magic links enabled.
- **No phone-OTP in this phase** — Supabase requires a paid SMS provider for it.
- Rewrite `LoginPage.jsx` / `SignupPage.jsx` to Supabase (`signInWithPassword`,
  `signUp`); replace `onAuthStateChanged` in `App.jsx` with `supabase.auth.onAuthStateChange`.
- Delete `src/utils/firebase.js` and all `VITE_FIREBASE_*` vars once done.

### 1.3 Wire-throughs
- `profileStorage.js` → reads/writes `profiles` row (localStorage becomes write-through cache).
- `ForecastPage` history → `forecasts` table (keep same-day uniqueness; regenerate updates row).
- `groqAgent.js` → call the Phase-0 Edge Function with a Supabase JWT header; user context on
  the server (function reads the JWT, rate-limits per user: max ~20 forecasts/day).

**Phase-1 done when:** signup/login/logout work; profile survives a second browser; forecast
runs only through the Edge Function; history loads from Postgres with localStorage fallback.

---

## Phase 2 — Offline-first PWA

Goal: morning forecast survives no-network conditions.

### 2.1 Install & shell
```bash
npm i vite-plugin-pwa dexie dexie-react-hooks workbox-window
```
- `vite.config.js` → `VitePWA({ registerType:'autoUpdate', workbox:{ navigateFallback:'/index.html' } })`
  plus manifest (name exceptions: keep "Bazaar Brain", theme + maskable icons).
- Precache app shell so the app opens with zero network.

### 2.2 Caching strategy per data type
| Data | Strategy |
|---|---|
| App shell / JS / CSS | Workbox precache |
| Open-Meteo weather | NetworkFirst, cache `weather-cache`, 2 h expiry |
| Holidays/events | StaleWhileRevalidate |
| Supabase REST | NetworkFirst with timeout fallback to Dexie cache |

### 2.3 Offline behavior
- **Always compute multipliers locally first** (weather cache + events module) — this decouples
  the deterministic plan from the LLM (prerequisite refactor for offline).
- Groq/Edge Function unreachable → render the deterministic plan in the same `ForecastResult`
  shape: summary text as "Offline — approximate plan" (EN + HI).
- Writes (profile edits, inventory, feedback, daily logs) go to Dexie **first**, then sync;
  queue table `pending_ops { client_id pk, op_type, payload, created_at, retries }`.
  Sync trigger: `online` event + `visibilitychange` (Background Sync API exists on Chromium;
  iOS Safari needs the event fallback). Client-generated `client_id`s keep replays idempotent.

**Phase-2 done when:** airplane-mode run produces a full usable plan; queued edits land in
Supabase after reconnect; Lighthouse ≥ 90 PWA category.

---

## Phase 3 — Vendor network MVP (posts-first)

Goal: hyperlocal surplus/need board per market. No chat in MVP.

### 3.1 Schema additions
```sql
create table markets (
  slug text primary key,
  name text not null,
  lat numeric not null,
  lon numeric not null,
  weekly_pattern jsonb,
  event_seeds jsonb
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  market_slug text not null references markets(slug),
  kind text not null check (kind in ('offer','want')),
  item_label text not null,
  qty numeric not null,
  unit text not null,
  price numeric,                     -- optional asking price
  note text,
  status text not null default 'open' check (status in ('open','matched','done')),
  expires_at timestamptz not null,   -- same-day expiry, max 12 h
  created_at timestamptz not null default now()
);
create index posts_board_idx on posts (market_slug, status, expires_at desc);
```

RLS:
- `SELECT`: `status <> 'done' AND expires_at > now() AND market_slug = (select market_slug
  from profiles where id = auth.uid())` — you only ever see your own market's board.
- `INSERT`: own row, `owner_id = auth.uid()`; `UPDATE/DELETE`: own rows only.

### 3.2 UI (new page `/market`)
- Tabs: 🟢 Surplus / 🔴 Needed. Post card: item, qty+unit, optional price, distance badge ("~30
  m, Janpath side" — cosmetic, from vendor-entered zone text for MVP), expiry countdown.
- Post form: item (from the user's own ingredient list via autocomplete + free text), qty+unit,
  price optional, expiry picker (today 12 PM / 4 PM / 8 PM / custom ≤ 12 h).
- Interest action: "मुझे चाहिए / Milega!" → reveals poster's phone number (from profile auth
  identity) — deliberately low-tech; UPI settlement happens off-platform at MVP.
- One active post per (owner, item, kind); posting overwrites the previous open one.
- Realtime: `supabase.channel('posts:<market_slug>')` → `postgres_changes` on INSERT/UPDATE to
  keep the board live without polling.

### 3.3 Scaling rule
Pilot = one market (`hazratganj`), invite ~15–20 vendors the team knows. Do not add zones,
chat, or settlement features until this board gets daily organic posts.

**Phase-3 done when:** two test accounts in the same market create/see/expire posts; RLS blocks
cross-market reads; board updates live without refresh.

---

## Phase 4 — Web Push (free, no WhatsApp)

Goal: "a neighbor just posted a need that matches your surplus" alerts.

- Add `push_subscriptions (user_id, subscription jsonb, platform)` table.
- Service worker: `push` event handler → show notification with deep link to the post.
- Edge Function `send-push`: uses `web-push` npm + VAPID keys; sends to all subscriptions of
  profiles in the same market whose (opposite kind) matching post exists.
- Trigger (simplest reliable): client that creates a matching post calls the Edge Function after
  insert; upgrade later to a DB webhook if needed.
- Permission UX: ask only after the user's first post or board visit (never on first load);
  iOS Safari only supports push for installed PWAs — surface "Add to Home Screen" hint.

**Phase-4 done when:** posting a `want` while offline users are online produces a notification
on another device within ~10 s, and Chrome refuses gracefully if permission denied.

---

## Phase 5 — Learning loop (make the promise true)

Goal: forecasts improve per vendor over time.

### 5.1 Daily log capture (low-friction)
- Post-day screen (evening, same session or next morning): for each item, prefilled chips —
  "सब बिक गया / कुछ बचा / काफी बचा" (+ optional exact quantities). One tap per item; ~10 s total.
- Writes one `daily_logs` row per item, linked to the day's `forecast_id`.

### 5.2 Model
- Per-vendor, per-item adjustment: EWMA correction
  `adj = 0.6·adj_old + 0.4·(actual_sold / predicted)` clamped to [0.5, 2.0], per item category.
- Cold start (< 7 days of logs): pure multiplier engine; after ≥ 7 days, blend; after ≥ 30
  days, vendor-specific dominates population defaults.
- Surface it honestly: SignalPanel shows "Learned from 14 days" and the applied correction.

### 5.3 Revenue estimator (subset of the roadmap item)
- If `profiles.prices` populated for an item → show expected stock cost, expected revenue
  (forecast × sell price), and break-even customers on the forecast output card.

**Phase-5 done when:** a test vendor logging actuals for a week shows a visibly different
multiplier than a fresh vendor, and the HistoryLog shows predictions vs. actuals.

---

## Phase 6 — MarketPack generalization (expansion-ready)

Goal: Lucknow's other markets and other cities become data, not code.

- `markets` table (Phase 3) becomes the Driver: coordinates → weather URL; `weekly_pattern`,
  `event_seeds` → event core; per-market stall archetype list.
- Landing/profile flow: pick your market (searchable list), defaulting stall archetypes from
  market metadata.
- Admin path (can be a Supabase table editor at MVP): add a market = insert one row + seeds.
- README, `.env.example`, and contribution docs updated to describe "add a new market in N
  minutes".

**Parked (explicitly out of scope):** WhatsApp/Telegram channels, group-buy settlement,
mandi price scraping, social-signal ingestion. Revisit only after Phases 0–6 are stable and
there's real revenue or a funding reason to spend on per-message costs.

---

## ⚠️ Agent operating instructions (read before implementing)

1. **Scope discipline.** Implement only the phase assigned. If a later-phase shortcut looks
   tempting, note it in the PR description instead of building it. Never re-introduce parked
   features (WhatsApp, chat, group buying, in-app settlement).
2. **Everything user-facing is bilingual (English + Hindi).** Hindi must be natural Hinglish-
   friendly Devanagari, written for a low-literacy user; short sentences, no jargon. Never
   machine-translate inline at runtime — ship static copy.
3. **Secrets server-side, always.** No new `VITE_`-prefixed secret handles. Groq goes only in
   Edge Functions. If a change adds any key to the client bundle, stop and redesign.
4. **Follow existing code style:** Tailwind v4 with the project's `--color-*` CSS variables,
   functional components + hooks, no new UI library or state library unless a phase
   explicitly calls for one. Keep the deterministic multiplier engine as pure functions —
   LLM only enriches (summary/notes/priority), never does arithmetic.
5. **Schema discipline.** Any Postgres table/RLS change: update the DDL section in this plan
   file in the same PR, state the migration order, and keep RLS deny-by-default. Never write
   a client query that would violate RLS as a shortcut (no service-role keys in the frontend).
6. **Offline-first sanity check:** after touching data paths, verify the page still renders a
   usable forecast in devtools "Offline" mode.
7. **Verification before claiming done:** `npm run lint`, `npm run build`, plus a manual pass
   of the phase's "done when" checklist. Report anything not verified — don't claim it.
8. **Commit per step**, message format `phase-N: <what changed>` (e.g. `phase-0: neutral
   weather fallback + surface approximate badge`). Never push the Groq key, VAPID private key,
   or `.env` to git.
9. **Breaking-change rule:** deleting Firebase auth or changing a table requires the fallback
   path (localStorage) to keep working in the same change — no state where a user logs in and
   finds an empty app.
10. **Write test/task notes** as you go into the plan file's "done when" checklists (tick or
    annotate), so the next agent inherits accurate state.
