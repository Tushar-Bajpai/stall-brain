# Bazaar Brain — Implementation Plan (v1)

> **Product:** Bazaar Brain — agentic daily procurement advisor for street vendors
> **Current repo:** `C:\Users\ASUS\OneDrive\Documents\Bazaar-Brain\stall-brain`
> **Locked decisions:** Firebase as the single backend (Firebase Auth, Firestore + Security
> Rules, Cloud Functions, FCM) · No WhatsApp/Telegram in any phase (parked indefinitely) · Vendor network starts
> "posts-first" (surplus/need board, same-day expiry) · Offline-first PWA · English + Hindi copy
> stays mandatory in all user-facing builds.

---

## 0. Guiding architecture

```
React 19 + Vite SPA  ──►  Firebase (Auth, Firestore + Security Rules, FCM)
   │                              │
   │ multiplier engine (local, offline-capable)          Vercel serverless function /api/forecast → Groq API
   │ Firestore SDK offline persistence = cache +          Vercel function /api/push-on-post (Phase 3) → FCM
   └ Free services only: Firebase Spark (free tier, NO Blaze), Open-Meteo, FCM, Vercel Hobby.
     User decision (2026-11-10): the Blaze plan is NOT adopted — server-side helpers run on
     Vercel serverless functions, not Firebase Cloud Functions (which require Blaze).
```

Environment contract (Firebase web config is **not** a secret — it identifies the project;
actual access control lives in Firestore Security Rules; never let any real secret — Groq key,
service-account credentials — get bundled into the client):

| Env var / credential | Where it lives |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | client (safe by design) |
| `GROQ_API_KEY` | Vercel env var only (read by `api/forecast.js`). Never a `VITE_` value in production |
| `FIREBASE_API_KEY` | Vercel env var — the same web API key as `VITE_FIREBASE_API_KEY` (an identifier; used by the proxy to verify the caller's ID token) |
| Web Push certificate key pair (VAPID) | generated in Firebase console (Cloud Messaging); public key → client as `vapidKey` for `getToken()`; private half stays in the console |
| Firebase service-account / Admin credentials | Vercel env var only (used by the Phase-3 push function); NEVER committed to the repo |

---

## Phase 0 — Fixes & Bugs (no new features, no new infrastructure)

Goal: the existing app becomes correct and honest before anything is added.

### 0.1 Remove the client-exposed Groq key (FIX-2)
- `src/utils/groqAgent.js` bundles `VITE_GROQ_API_KEY` into shipped JS.
- Interim-at-the-time step: a server-side proxy keeps the client contract identical (same
  request shape, same response, same error codes). On the free plan (user decision
  2026-11-10) this is the **Vercel serverless function `api/forecast.js`** — Firebase Cloud
  Functions are unusable on Spark and the Blaze plan is not adopted.
- Full wiring in Phase 1: client set `VITE_FORECAST_URL=/api/forecast`, Vercel holds
  `GROQ_API_KEY` (+ `FIREBASE_API_KEY` for ID-token verification) as env vars.
- Delete `VITE_GROQ_API_KEY` from production env (it remains as the local-dev fallback only).

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
  Phase 1 — do not block Phase 0 on the server-side migration.

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

### 0.10 Config resilience (FIX-16..18) — added during implementation
- **FIX-16:** `firebase.js` throws a descriptive error listing exactly which `VITE_FIREBASE_*`
  values are missing, instead of the previous silent white screen.
- **FIX-17:** the Groq model is configurable via `VITE_GROQ_MODEL` (default `openai/gpt-oss-120b`,
  fallback `qwen/qwen3.8-27b` auto-retry on 404). Reason: Groq retired `llama-3.3-70b-versatile`
  mid-2026 and every forecast 404'd while the app mislabeled it "Groq is unavailable" — the
  outage must be a config edit, not a code hunt.
- **FIX-18:** distinct failure surfacing — 401/403 (key rejected), 404/`model_not_found`,
  429 (rate limit), and network failures each get their own message instead of a blanket
  "Groq is unavailable".

**Phase-0 done when:** a fresh user can run a forecast with zero Groq key in the bundle; events
fire for at least one upcoming real date; feedback survives regenerate; history stores full
results; `npm run build` + `npm run lint` pass.

### Phase-0 status (2026-11-10) — implemented
Done:
- FIX-1: runtime event core (`date-holidays` India/UP + verified 2026 `marketSeeds.js`).
  Note: `date-holidays` v3.39.1 `getHolidays(y,m,d)` **ignores the day arg** and returns the
  whole year — the code fetch-guards per year and filters `entry.date.slice(0,10)`. Its India
  dataset ships only 6 fixed holidays; Diwali/Holi/Eid-scale events come from the seeds file,
  which must be re-verified each year (maintenance contract written into the file header).
- FIX-3: per-user scoped storage (`bb_<uid>_*` keys via `src/utils/userScope.js`), with one-time
  migration from legacy `bazaarBrain_profile` / `bazaarBrain_session` / `bazaarBrainHistory`.
- FIX-4/7: same-day regenerate upserts the existing history entry and preserves feedback;
  FeedbackBar copy is now "Noted — saved to your history."
- FIX-5: history cap 5 → 50; each entry stores the full `ForecastResult`.
- FIX-6: neutral weather failure — failure state sets the exported
  `WEATHER_UNAVAILABLE_SIGNAL` (×1, "Weather data unavailable") instead of fabricating
  "Clear & Sunny 1.2×"; the "Using fallback weather" badge already existed.
- FIX-8/9: weather refetch every 30 min + on `visibilitychange`; `dateInfo` is state with a
  minute tick, and a midnight rollover clears a stale forecast card (a same-day cache may
  instantly restore today's fresh run).
- FIX-10: numeric schema + client-side arithmetic repair (`toBuy = max(0, totalNeeded −
  alreadyHave)`) with cross-check against the real Groq API (gpt-oss-120b, 2026-11-10);
  temperature 0.2; day forecast cached in `sessionStorage` per stall+date.
- FIX-11/12/13: dead `SetupPage` + `selectionStorage` + `/setup` route and fake
  `LOADING_DURATION` removed; `RequireAuth` hoisted to module scope.
- FIX-14/15: `.env.example` created; README clone URL/model/file-tree synced.
- FIX-16/17/18 as above.
- `npm run lint` and `npm run build` both pass (lint had pre-existing
  `react-hooks/set-state-in-effect` failures in LoadingState/LoginPage/SignupPage — fixed by
  lazy state init / documented "adjust state on prop change" render pattern).

Deferred (only the Groq-key piece of FIX-2):
- The Groq key is still bundled client-side for local dev. The **Vercel proxy
  `api/forecast.js` ships in Phase 1**: once it is deployed with `GROQ_API_KEY` + as Vercel
  env vars and `VITE_FORECAST_URL=/api/forecast` is set (see Phase-1 status below), the key
  leaves the bundle — `groqAgent.js` already prefers the proxy path automatically.
- App bundle is 2,009 kB (minified, 416 kB gzip) — `date-holidays` pulls its full data index.
  Follow-up: dynamic-import the holidays year lazily or vendor only the UP rules.

---

## Phase 1 — Firebase migration (auth + server-side data)

Goal: one identity system, server-persisted per-user data, Function in production.

> Already true in the repo: `src/utils/firebase.js` initializes the Firebase app and
> `firebase/auth` powers signup/login/session. Phase 1 adds **Firestore** for per-user data and
> moves the Groq call behind the **`/api/forecast` Vercel proxy**. There is no Supabase anywhere
> in this plan.

### 1.1 Firestore data model & security rules (deny-by-default)

Firestore data model (subcollections keep every row user-owned by construction):

```
profiles/{uid}                       ← doc id = the Auth uid
  stallType, stallLabel, stallEmoji, ingredients[], prices (map, optional — Phase 4),
  marketSlug ("hazratganj" default), createdAt

profiles/{uid}/forecasts/{fdate}     ← doc id = "YYYY-MM-DD" ⇒ hard one-per-day uniqueness;
  stallType, expectedCustomers, demandMultiplier,       regenerate = set(..., { merge } )
  result (full ForecastResult), inventorySnapshot,
  feedback, createdAt

profiles/{uid}/dailyLogs/{autoId}    ← one doc per item, linked to the day's forecast
  fdate, forecastId, itemLabel, unit, predicted, actualSold, actualLeft, createdAt
```

Security rules (every path user-owned; deny all else):

```
match /profiles/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
  match /forecasts/{fdate} { allow read, write: if request.auth.uid == uid; }
  match /dailyLogs/{logId} { allow read, write: if request.auth.uid == uid; }
}
```

Each vendor sees only their own rows — enforced by the database (rules), not the UI.

### 1.2 Auth migration
- Firebase Auth: **email + password** is already live in the app; toggle on **Google sign-in**
  (free) and Email-link ("magic link") sign-in, which needs only Authorized-Domains config.
- **No phone-OTP in this phase** — SMS verification requires the paid tier on every provider.
- Ship **`api/forecast.js`** on Vercel (free Hobby tier — no Blaze): set `GROQ_API_KEY` and
  `FIREBASE_API_KEY` as Vercel env vars, set `VITE_FORECAST_URL=/api/forecast`, redeploy. The
  proxy verifies the caller's Firebase ID token with the free Identity Toolkit endpoint and
  forwards the body to Groq.

### 1.3 Wire-throughs
- `profileStorage.js` → keeps its localStorage contract; `cloudStore.js` mirrors the profile to
  `profiles/{uid}` via the Firestore SDK (localStorage = offline write-through cache).
- `ForecastPage` history → `profiles/{uid}/forecasts/{fdate}` (same-day uniqueness by doc id;
  regenerate = `set` with merge; feedback rides on the same doc).
- `groqAgent.js` → production path is a fetch to `VITE_FORECAST_URL` (`/api/forecast`) with the
  user's Firebase **ID token as Bearer** auth; the Vercel function verifies it and rate-limits
  per user (best-effort ~20 forecasts/day). The direct-`VITE_GROQ_API_KEY` call remains ONLY as
  a local-dev fallback.

**Phase-1 done when:** signup/login/logout work; profile survives a second browser; forecast
runs through the `/api/forecast` proxy in production; history loads from Firestore with
localStorage fallback.

### Phase-1 status (2026-11-10) — implemented in code, awaiting setup + verification

Done:
- `src/utils/firebase.js` exports `db` (Firestore) with on-device persistent cache
  (`persistentLocalCache` + multi-tab manager) — groundwork for the Phase-5 offline PWA.
- `firestore.rules` committed (deny-by-default): user-owned `profiles/{uid}` subtree, forecast
  doc ids validated as `YYYY-MM-DD`, `dailyLogs` reserved for Phase 4, posts denied until Phase 2.
- `src/utils/cloudStore.js`: `saveCloudProfile`/`loadCloudProfile`,
  `saveCloudForecast` (doc id = date, merge-preserves first `createdAt`),
  `updateCloudForecastFeedback`, `loadCloudHistory` (createdAt desc, limit 50).
- `ProfilePage`: when the device has no cached profile, it restores from Firestore and warms
  the local cache; every save also mirrors to Firestore (fire-and-forget — fallback path intact).
- `ForecastPage`: restores history from Firestore when the local cache is empty; every forecast
  upsert and feedback write also lands in Firestore; localStorage remains source-of-truth offline.
- `api/forecast.js`: Vercel proxy — Bearer ID token verified via Google's free Identity Toolkit
  endpoint, model allowlist (`GROQ_MODELS`), `max_tokens` clamp, best-effort per-user rate limit
  (~20/day), Groq response passed through verbatim (client FIX-18 mapping unaffected).
- `groqAgent.js`: proxy path preferred via `VITE_FORECAST_URL` (Bearer ID token, no key in the
  bundle); direct Groq with `VITE_GROQ_API_KEY` is the local-dev fallback only.
- `eslint.config.js`: `api/` excluded from the root browser lint config; the Phase-0 Blaze
  scaffold (`functions/`, `firebase.json`) was removed.

**User actions to light it up (blocking "done when"):**
1. Firebase console → Firestore Database → **Create database** → paste `firestore.rules` →
   Publish.
2. Vercel → Project → Settings → Environment Variables: add `GROQ_API_KEY` (gsk_…),
   `FIREBASE_API_KEY` (same value as `VITE_FIREBASE_API_KEY`), `VITE_FORECAST_URL=/api/forecast`;
   remove `VITE_GROQ_API_KEY` from production environments.
3. Redeploy → verify: (a) saving a profile creates `profiles/{uid}`; (b) a forecast creates
   `profiles/{uid}/forecasts/<today>`; (c) logging in on a second browser restores profile +
   history without localStorage; (d) the deployed JS bundle no longer contains `gsk_`.

---

## Phase 2 — Vendor network MVP (posts-first)

Goal: hyperlocal surplus/need board per market. No chat in MVP.

### 2.1 Firestore schema additions

```
markets/{slug}                     ← doc id = slug (e.g. "hazratganj")
  name, lat, lon, weeklyPattern (map), eventSeeds (map)

posts/{autoId}
  ownerId, marketSlug, kind ('offer' | 'want'), itemLabel, qty, unit,
  price (optional asking price), note,
  status ('open' | 'matched' | 'done'), expiresAt (same-day expiry, max 12 h), createdAt
```

Composite index: `posts (marketSlug asc, status asc, expiresAt desc)`.

Security rules (deny-by-default; anything not explicitly allowed is rejected):
- `read`: signed-in AND the post is live — `resource.data.status != 'done'` &&
  `resource.data.expiresAt > request.time` — AND it belongs to the reader's market:
  `resource.data.marketSlug == get(/databases/(default)/documents/profiles/$(request.auth.uid)).data.marketSlug`
  (own profile doc is readable under Phase-1 rules, so the `get()` is cheap). You only ever
  see your own market's board — enforced by the database, not the UI.
- `create`: `request.resource.data.ownerId == request.auth.uid` AND own marketSlug matches the
  reader's profile AND `expiresAt <= request.time + 12h` AND `kind`/`status` are valid values.
- `update`/`delete`: own rows only (`resource.data.ownerId == request.auth.uid`).

### 2.2 UI (new page `/market`)
- Tabs: 🟢 Surplus / 🔴 Needed. Post card: item, qty+unit, optional price, distance badge ("~30
  m, Janpath side" — cosmetic, from vendor-entered zone text for MVP), expiry countdown.
- Post form: item (from the user's own ingredient list via autocomplete + free text), qty+unit,
  price optional, expiry picker (today 12 PM / 4 PM / 8 PM / custom ≤ 12 h).
- Interest action: "मुझे चाहिए / Milega!" → reveals poster's phone number (from profile auth
  identity) — deliberately low-tech; UPI settlement happens off-platform at MVP.
- One active post per (owner, item, kind); posting overwrites the previous open one
  (query-then-write; the deterministic delete/set order keeps replays harmless).
- Realtime: a Firestore `onSnapshot` listener on
  `posts where marketSlug == mine && status == 'open' && expiresAt > now, orderBy expiresAt desc`
  keeps the board live without polling — realtime is part of the free Firestore tier.

### 2.3 Scaling rule
Pilot = one market (`hazratganj`), invite ~15–20 vendors the team knows. Do not add zones,
chat, or settlement features until this board gets daily organic posts.

**Phase-2 done when:** two test accounts in the same market create/see/expire posts; rules
block cross-market reads (verify with Emulator Suite rules tests); board updates
live without refresh.

---

## Phase 3 — Web Push (free, no WhatsApp)

Goal: "a neighbor just posted a need that matches your surplus" alerts.

- Add `fcmTokens/{autoId}` collection: `{ userId, token, platform, createdAt }`.
- Generate a **Web Push certificate key pair** in the Firebase console (Cloud Messaging → Web
  Push certificates); its public key is the `vapidKey` argument of `getToken()` from
  `firebase/messaging` on the client. No server-side push library or VAPID env plumbing is
  needed — sending happens through the Admin SDK.
- Service worker `firebase-messaging-sw.js`: `onBackgroundMessage` → show notification with
  deep link to the post.
- Vercel function **`api/push-on-post.js`** (free plan; Spark has no Firestore-trigger Cloud
  Functions): after a successful post create, the client calls it with its Firebase ID token.
  The function (service-account credential as a Vercel secret, via the REST-friendly Admin SDK
  pattern) loads profiles in the same market holding an open post of the opposite matching
  kind and calls FCM HTTP v1 `messaging.sendEachForDevice` for their tokens; prune tokens that
  respond `messaging/registration-token-unregistered`.
- Documented trade-off of the free plan: the trigger is *client-called* rather than a
  server-side document write, so a poster closing the tab mid-action skips that one alert.
  Upgrade path: adopt a real `onDocumentCreated` trigger only if/when Blaze is ever adopted —
  nothing else changes.
- Permission UX: ask only after the user's first post or board visit (never on first load).
- iOS note: Safari only supports Web Push in **installed PWA state** — until the offline-first
  PWA lands (Phase 5), iOS users can connect with the in-app approach nonetheless; surface an
  "Add to Home Screen" hint and treat iOS push as Phase-5 enhancement.
- Free: FCM costs nothing on the Spark plan.

**Phase-3 done when:** posting a `want` while other users are online produces a notification
on another device within ~10 s, and Chrome refuses gracefully if permission denied.

---

## Phase 4 — Learning loop (make the promise true)

Goal: forecasts improve per vendor over time.

### 4.1 Daily log capture (low-friction)
- Post-day screen (evening, same session or next morning): for each item, prefilled chips —
  "सब बिक गया / कुछ बचा / काफी बचा" (+ optional exact quantities). One tap per item; ~10 s total.
- Writes one `profiles/{uid}/dailyLogs` doc per item, linked to the day's forecast doc (`fdate`).

### 4.2 Model
- Per-vendor, per-item adjustment: EWMA correction
  `adj = 0.6·adj_old + 0.4·(actual_sold / predicted)` clamped to [0.5, 2.0], per item category.
- Cold start (< 7 days of logs): pure multiplier engine; after ≥ 7 days, blend; after ≥ 30
  days, vendor-specific dominates population defaults.
- Surface it honestly: SignalPanel shows "Learned from 14 days" and the applied correction.

### 4.3 Revenue estimator (subset of the roadmap item)
- If `profiles.prices` (map field on the profile doc) is populated for an item → show expected
  stock cost, expected revenue (forecast × sell price), and break-even customers on the
  forecast output card.

**Phase-4 done when:** a test vendor logging actuals for a week shows a visibly different
multiplier than a fresh vendor, and the HistoryLog shows predictions vs. actuals.

---

## Phase 5 — Offline-first PWA

Goal: morning forecast survives no-network conditions. **Moved last (user decision,
2026-11-10):** ship the network features first, harden offline afterward.

### 5.1 Install & shell
```bash
npm i vite-plugin-pwa workbox-window        # add `dexie` only if §5.3 ever needs a manual queue
```
- `vite.config.js` → `VitePWA({ registerType:'autoUpdate', workbox:{ navigateFallback:'/index.html' } })`
  plus manifest (name exceptions: keep "Bazaar Brain", theme + maskable icons).
- Precache app shell so the app opens with zero network.

### 5.2 Caching strategy per data type
| Data | Strategy |
|---|---|
| App shell / JS / CSS | Workbox precache |
| Open-Meteo weather | NetworkFirst, cache `weather-cache`, 2 h expiry |
| Holidays/events | StaleWhileRevalidate |
| Firestore data | Firebase SDK offline persistence (IndexedDB, `persistentLocalCache()`); writes made offline are queued by the SDK itself and replayed automatically on reconnect |

### 5.3 Offline behavior
- **Always compute multipliers locally first** (weather cache + events module) — this decouples
  the deterministic plan from the LLM (prerequisite refactor for offline).
- Groq/`/api/forecast` unreachable → render the deterministic plan in the same
  `ForecastResult` shape: summary text as "Offline — approximate plan" (EN + HI).
- Writes (profile edits, inventory, feedback, daily logs, market posts) go straight through the
  Firestore SDK, which persists them offline and replays on reconnect — no hand-rolled Dexie
  queue is needed for these paths. Idempotency is guaranteed by design: profile = `set`/merge,
  forecast = deterministic `{fdate}` doc id, daily logs = client-generated doc ids. A Dexie
  `pending_ops` queue is added only if a specific write path proves to need it. Sync
  trigger: the SDK replays on `visibilitychange`/reconnect natively.
- Note: offline Firestore persistence (`persistentLocalCache`) is established as soon as
  Phase 1 stores data in Firestore. The Phase-5 work is the app-shell/service-worker layer on
  top of that — Web Push from Phase 3 also starts working for iOS once the PWA install shell
  is in place.

**Phase-5 done when:** airplane-mode run produces a full usable plan; queued edits land in
Firestore after reconnect; Lighthouse ≥ 90 PWA category.

---

## Phase 6 — MarketPack generalization (expansion-ready)

Goal: Lucknow's other markets and other cities become data, not code.

- The `markets` collection (Phase 2) becomes the Driver: coordinates → weather URL;
  `weeklyPattern`, `eventSeeds` → event core; per-market stall archetype list.
- Landing/profile flow: pick your market (searchable list), defaulting stall archetypes from
  market metadata.
- Admin path (can be the Firebase console's Firestore editor at MVP): add a market = insert one
  doc + seeds.
- README, `.env.example`, and contribution docs updated to describe "add a new market in N
  minutes".

**Parked (explicitly out of scope):** WhatsApp/Telegram channels, group-buy settlement,
mandi price scraping, social-signal ingestion. Revisit only after Phases 0–6 are stable and
there's real revenue or a funding reason to spend on per-message costs.

---

## ⚠️ Agent operating instructions (read before implementing)

0. **Stop-and-wait after every phase (user decision, 2026-11-10).** After a phase's checklist
   and verification pass is done, STOP — post a short summary of what shipped, the
   verification results, and any open questions. The user then reviews and gives explicit
   approval to proceed to the next phase. **Never start Phase N+1 unprompted.**
1. **Scope discipline.** Implement only the phase assigned. If a later-phase shortcut looks
   tempting, note it in the PR description instead of building it. Never re-introduce parked
   features (WhatsApp, chat, group buying, in-app settlement).
2. **Everything user-facing is bilingual (English + Hindi).** Hindi must be natural Hinglish-
   friendly Devanagari, written for a low-literacy user; short sentences, no jargon. Never
   machine-translate inline at runtime — ship static copy.
3. **Secrets server-side, always.** No new `VITE_`-prefixed secret handles in production.
   `GROQ_API_KEY` lives in Vercel env vars (read by `api/forecast.js`); the Phase-3 service
   account lives in Vercel env vars too. No Blaze plan is adopted (user decision 2026-11-10),
   so there are no Firebase Cloud Functions. If a change adds any secret to the client bundle,
   stop and redesign.
4. **Follow existing code style:** Tailwind v4 with the project's `--color-*` CSS variables,
   functional components + hooks, no new UI library or state library unless a phase
   explicitly calls for one. Keep the deterministic multiplier engine as pure functions —
   LLM only enriches (summary/notes/priority), never does arithmetic.
5. **Schema discipline.** Any Firestore collection or security-rules change: update the
   data-model section in this plan file in the same PR, deploy/test rules with the Firestore
   Emulator Suite first, and keep rules deny-by-default. Never write a client query that
   would be rejected by security rules as a shortcut (no service-account keys in the frontend,
   ever).
6. **Offline-first sanity check:** after touching data paths, verify the page still renders a
   usable forecast in devtools "Offline" mode.
7. **Verification before claiming done:** `npm run lint`, `npm run build`, plus a manual pass
   of the phase's "done when" checklist. Report anything not verified — don't claim it.
8. **No commits or pushes from the agent.** The user handles all git operations personally;
   the agent only edits files on disk. If the user asks for a suggested message, use the
   format `phase-N: <what changed>` (e.g. `phase-0: neutral weather fallback + surface
   approximate badge`). Never help stage or commit `.env`, service-account keys, or any
   secret.
9. **Breaking-change rule:** restructuring a collection or changing auth behavior requires
   the fallback path (localStorage) to keep working in the same change — no state where a
   user logs in and finds an empty app.
10. **Write test/task notes** as you go into the plan file's "done when" checklists (tick or
    annotate), so the next agent inherits accurate state.
