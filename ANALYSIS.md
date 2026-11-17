# Repository Analysis — `reedmad4-netizen/al-cuts` (CLIPX AI v1.4.0)

**Analyzed:** 2026-11-17 · branch `arena/5af5ddc6-al-cuts` @ `e021333` · reviewer: Arena agent
**Method:** static review of every source file, dependency audit, and a live build + runtime smoke test of the app extracted from `clipx-ai-project6.zip`.

> **Status update:** the P0 and P1 findings below were fixed and verified in **v1.5.0** — see [§9 Remediation log](#9-remediation-log--v150-2026-11-17). The grades and findings in §1–§8 describe the repository as it was at commit `e021333`.

---

## 1. Executive summary

This repo is **not a source repository** — it is a wrapper around an 18 MB zip file. The root contains only the build/config files (`package.json`, `server.mjs`, `next.config.mjs`, `tailwind.config.ts`, …) plus `clipx-ai-project6.zip`, which holds the actual application (76 files, ~18.8k lines of TypeScript/TSX). The 11 files at the root are byte-identical to their copies inside the zip, so the zip is a redundant snapshot of the project, not a different version.

The product itself — an AI-ish "auto clip generator" for gaming streams — is **substantially real and works**. I installed it, built it (`next build` succeeds cleanly), started it, and exercised the API: the landing page and all 8 other app screens return 200, demo login works, demo clips and media streaming work, SQLite initializes and seeds itself, and the HLS ring-buffer capture architecture is genuinely implemented rather than mocked.

However, this is a **development prototype pushed straight to a public GitHub repo**, and it shows in three dimensions:

| Dimension | Verdict |
|---|---|
| Architecture & completeness | Solid for a demo — real capture pipeline, real DB, real WS chat, sane layering |
| **Security** | **Unacceptable for anything beyond localhost** — forgeable sessions, missing authorization, anonymous writes, critical framework CVEs |
| Production readiness / robustness | Low — one optional dep silently disables every video feature, in-memory single-process state, no tests/CI/license |
| Documentation accuracy | Mixed — unusually detailed README, but several claims are wrong or overstated |

**Headline risks:** an attacker can forge a valid session cookie (demonstrated), can delete or modify any user's streams and start expensive captures without authenticating, can upload 60 MB files anonymously, and the pinned Next.js 14.2.35 carries **critical RCE advisories**.

**Overall grade: C−** — impressive portfolio/technical demo, not deployable as-is.

---

## 2. What the repository actually contains

```
al-cuts/                        ← repo root: config only, no src/
├── clipx-ai-project6.zip       ← 18.2 MB, the entire app (76 files)
├── package.json                ← deps/scripts (dev → server.mjs --dev)
├── server.mjs                  ← custom Node HTTP + WS server bootstrapping Next
├── next.config.mjs             ← includes e2b.app sandbox origins
├── package-lock.json
├── tailwind/postcss/tsconfig, .env.example, README.md
└── .gitignore
```

Inside the zip:

```
clipx-ai/
├── server.mjs, next.config.mjs, package.json …
├── public/media/{clips,posters,streams}/   ← ~19 MB of committed demo video
├── scripts/{node-compat,run-next,generate-sample-media}.mjs
├── supabase/schema.sql                     ← Postgres mirror (unused by runtime code)
└── src/
    ├── app/
    │   ├── page.tsx                        (454)   landing
    │   ├── dashboard|monitoring|clips|editor|chat|downloads|settings|auth
    │   └── api/…                           20 route.ts files
    ├── components/                         AppProvider (773), StudioShell, ClipCard…
    └── lib/
        ├── monitor-engine.ts   (2070)      orchestration, jobs, exports
        ├── live-sources.ts     (1890)      Twitch/YouTube/Kick/HLS resolvers + ring buffer
        ├── db.ts               (1158)      sql.js wrapper, schema, seeds
        ├── ffmpeg.ts           (1109)      probe, encode, ASS captions, audio analysis
        ├── live-chat.ts        (410)       IRC / live chat polling
        ├── platform-api.ts     (390)       official API clients
        ├── ai-scoring.ts       (299)       hype lexicon + scoring
        └── auth.ts, db helpers, supabase, types
```

**Stack:** Next.js 14.2.35 (App Router) · React 18 · TypeScript (strict) · Tailwind · custom `node:http` + `ws` server · `sql.js` (WASM SQLite, file-persisted) · FFmpeg/FFprobe · `bcryptjs` + `jose` HS256 JWT in an HttpOnly cookie · optional Supabase Auth.

**Layering** is conventional and mostly clean: pages → `fetch('/api/…')` → route handlers → `lib/*` → sql.js. `server.mjs` is a legitimate bootstrap: it pre-initializes the WASM SQLite engine on `globalThis`, upgrades `/api/ws` to its own WebSocket server, and delegates everything else to Next's request handler.

---

## 3. Verified runtime behaviour

Performed in a scratch copy of the zip (Node 22.22, no system FFmpeg):

| Check | Result |
|---|---|
| `npm install` | ✅ 123 packages in ~13 s |
| `npm run build` | ✅ compiles, all 20 API routes + 11 page routes emitted, first-load JS ~87 kB |
| `PORT=3100 npm start` | ✅ boots, listens on `0.0.0.0:3100`, WS at `/api/ws` |
| `/`, `/dashboard`, `/monitoring`, `/clips`, `/editor`, `/chat`, `/downloads`, `/settings`, `/auth` | ✅ all HTTP 200 |
| `POST /api/auth/demo` → cookie → `/api/auth/me` | ✅ demo user `user-demo` / Kai Mercer |
| `GET /api/clips`, `/api/dashboard`, `/api/streams` | ✅ 4 seeded demo clips, metrics, demo sandbox stream |
| `GET /api/media/clips/demo-fps-clutch.mp4` | ✅ 3.0 MB served, range support present |
| `POST /api/streams/:id/trigger` | ❌ **`FFmpeg not found (spawn ffmpeg ENOENT)`** |
| `POST /api/clips/:id/scan-music` | ⚠️ returns "Clean … audio **verified**" although FFmpeg never ran (see §5.4) |
| `npm audit --omit=dev` | ❌ 1 critical, 2 high |

The app is genuinely functional; the failures are configuration/robustness issues, not vaporware.

---

## 4. Security findings

### 🔴 S1 — Session forgery via hardcoded JWT fallback secret (critical)

`src/lib/auth.ts:20-24`

```ts
const secret =
  process.env.CLIPX_AUTH_SECRET ||
  "clipx-ai-studio-hmac-session-key-2026-v1";
```

If `CLIPX_AUTH_SECRET` is unset — the default for anyone following the docs — every session token is signed with a **public constant committed to a public repo**. Worse, the README tells users to set the *wrong variable* (`README.md:91` → `JWT_SECRET=…`), while the code and `.env.example:2` use `CLIPX_AUTH_SECRET`. A user who follows the README carefully still ends up with the forgeable default secret.

**Proof:** against a server started *without* the env var, I minted `HS256{ sub: "user-demo" }` with that literal secret and `GET /api/auth/me` returned the full account and settings. Any user id is equally forgeable → complete authentication bypass. Because user ids are exposed in API responses, this is a direct account-takeover path.

**Fix:** fail fast when the secret is missing (`throw` at boot, no fallback), read `JWT_SECRET`/`CLIPX_AUTH_SECRET` consistently, use ≥32 random bytes from a secret manager, and rotate. Also set `iss`/`aud` on the JWT.

### 🔴 S2 — Missing authorization on streams (critical, IDOR)

`src/app/api/streams/[id]/route.ts`

* `PATCH` (line 29): loads the stream, never compares `stream.userId` to the caller.
* `DELETE` (line 176): no ownership check at all — any **anonymous** caller who knows an id calls `stopStreamMonitoring`, **deletes the uploaded source file from disk**, and removes the DB row.
* `POST /api/streams/[id]/trigger` and `POST /api/clips/[id]/scan-music` likewise run work on any stream/clip without an ownership check.

Mitigating nuance: `GET /api/streams` *is* scoped (`WHERE user_id IS NULL OR user_id = ?`), so other users' rows are not enumerable and ids are 10-char random strings — exploitation of a *specific* user's stream needs an id leak (shared link, log, WS payload). But **unowned streams (`user_id IS NULL`) are fully exposed** — any visitor can list, retune, capture from, or delete them, including ones another guest created and is actively monitoring. This is still an authorization gap, and it is inconsistent: the clip routes call `canUserExportClip`, streams have nothing.

**Fix:** a single `assertStreamAccess(stream, user)` helper (`stream.userId === null ? public : stream.userId === user?.id`), applied to PATCH/DELETE/trigger/scan-music; use the same helper the clip routes already have.

### 🔴 S3 — Anonymous writes into shared state and disk (high)

* **Uploads:** `src/app/api/streams/upload/route.ts` writes the file to `public/media/uploads/` **before** `getCurrentUser()` (line 80) is even called, and never requires a user. Only a self-asserted `isAuthorized=true` checkbox gates it. 60 MB per request × unlimited requests = trivial disk exhaustion and anonymous content publication under your origin.
* **Settings:** `src/app/api/settings/route.ts:127` uses `const targetId = user?.id || "user-demo";`. An unauthenticated `PUT /api/settings` therefore **overwrites the demo account's row**, including `twitch_client_id`, `twitch_access_token`, `youtube_api_key`, `kick_api_token` — i.e., a guest can plant credentials that the server will then use for outbound API calls, and can silently change every global preference.

**Fix:** require auth for uploads and settings writes; reject guest writes instead of aliasing them to `user-demo`; validate/normalise uploads to a non-public temp dir, transcode, then move; add per-user quotas.

### 🔴 S4 — Vulnerable framework version (critical)

`npm audit --omit=dev` flags **`next@14.2.35`** with 1 critical + several high advisories, including unauthenticated RCE in the Image Optimization API (SVG/AVIF), RCE on Windows-hosted servers (path traversal, CVSS 9.0), and SSRF in Server Actions on custom servers. Several of these apply to this exact setup (self-hosted, custom `server.mjs`, `next/image`). `images.unoptimized: true` reduces exposure but does **not** remove the `/_next/image` endpoint.

Also high: `postcss <=8.5.22` (source-map path traversal / arbitrary file read) and `zod <4.6.6` (memory exhaustion).

**Fix:** move to Next ≥ 15.5.24 (or 16.x) and re-test; bump postcss and zod; enable Dependabot/`npm audit` in CI.

### 🟠 S5 — No rate limiting anywhere (high)

There is no limiter, lockout, or backoff on `/api/auth/login` (bcrypt cost 10 → offline-speed online brute force is practical), `/api/auth/register`, `/api/streams/upload`, `/api/streams/discover` (proxies Twitch GQL), or `/api/streams/:id/trigger` (spawns FFmpeg). Combined with S2/S3 this makes cheap denial-of-service and CPU/disk abuse possible from one unauthenticated client.

**Fix:** per-IP + per-user token buckets; stricter province for auth endpoints; cap concurrent monitor sessions and capture jobs globally.

### 🟠 S6 — Session cookie and CORS weaknesses (medium)

* `auth.ts:46-53`: cookie is `httpOnly`, `sameSite: "lax"`, but **no `secure: true`** — it will be sent over plain HTTP if the app is exposed without TLS.
* `next.config.mjs:25-27`: `Access-Control-Allow-Origin: *` on **every** response, including `/api/settings` and `/api/auth/me`. Wildcard + cookie auth doesn't leak credentials to scripts (browsers block `credentials` with `*`), but it does make all guest-readable endpoints embeddable by any origin, and it signals a missing CORS policy.

**Fix:** `secure: process.env.NODE_ENV === "production"`, add `__Host-` prefix, replace the wildcard with an allowlist (or drop CORS entirely for same-origin usage), add CSP/HSTS/`X-Frame-Options`.

### 🟠 S7 — WebSocket broadcasts every tenant's data to every client (medium)

`server.mjs` keeps one global client set and `broadcastWs()` (`monitor-engine.ts:112`) sends to all of them. Consequently every connected browser receives `chat_message`, `buffer_tick`, `chat_surge`, `job_update` and `stream_updated` events for **every monitored stream**, regardless of owner or login state — live chat from other users' channels, their thresholds, buffer state and clip events. There is no per-connection subscription or filtering, and the `/api/ws` upgrade performs no origin check.

**Fix:** authenticate the WS handshake, tag sockets with a user id, and filter events per subscription (or at minimum per user, with demo broadcasts separated).

### 🟡 S8 — Secrets at rest, CSRF, misc (low–medium)

* Platform API tokens are stored **in plaintext** in `data/clipx.db` (`user_settings.twitch_access_token`, etc.). They are masked on read (`api/settings` returns `"••••••••"`), which is good, but the DB file is unencrypted and is a backup/snapshot liability.
* No CSRF tokens. `sameSite=lax` blocks most cross-site POSTs, but `multipart/form-data` uploads and any `GET`-triggered state changes would not be covered.
* `PATCH /api/clips/:id` with `saveToAccount: true` lets **any** signed-in user claim any unowned clip (`userId === null`). Intentional for demos, dangerous once real clips are unowned.
* No `Content-Security-Policy`; `server.mjs` trusts any `/api/ws` upgrade with no origin check.

### ✅ Security things that are done right

* **Prepared statements everywhere** — no string-interpolated user input into SQL.
* **Zod validation** on essentially every mutating route; consistent 400 handling.
* **Path traversal guard** in `api/media/[...path]` (`startsWith(mediaRoot + sep)`) and in clip deletion (only `public/media/generated`).
* **No shell injection:** FFmpeg is always invoked via `spawn(bin, args[])`, never a shell string; ASS caption text is escaped (`escapeAssText`).
* Multipart extension allowlist + real `ffprobe` verification before a stream is accepted.
* `bcryptjs` hashing, HttpOnly JWT, `poweredByHeader: false`, no hardcoded credentials beyond S1.

---

## 5. Correctness, reliability and honesty of features

### 5.1 FFmpeg is effectively a single point of failure — and it silently disappears 🟠

`ffmpeg-static` and `ffprobe-static` are declared under **`optionalDependencies`**. In a fresh `npm install` here, `ffmpeg-static` was **not installed at all** (`npm outdated` → `ffmpeg-static MISSING`), while `ffprobe-static` was. There is no system FFmpeg in the sandbox, so `getFfmpegBin()` falls through to the literal string `"ffmpeg"` (`ffmpeg.ts:131`), and every capture/edit/export fails with `spawn ffmpeg ENOENT`.

This directly contradicts the README's central promise ("no manual FFmpeg installation required"). Because optional dependencies fail silently by design, users on any platform where the postinstall is skipped get a half-working app with no startup warning.

**Fix:** make FFmpeg a hard requirement, validate both binaries at boot and print a clear diagnostic + disable capture UI; expose `/api/health` reporting binary paths/versions; pin versions.

### 5.2 The "copyright music detection" is a heuristic that presents itself as identification 🟠

`analyzeMusicCopyright` (`ffmpeg.ts:333`) is a two-threshold rule: `rmsDb > -24.5 && crestFactor < 13.5`. It then labels the result:

> «Sustained Musical Backing Track (**Acoustic ID #A1B2C3D4E5**)»

…where the "Acoustic ID" is `sha1(rms:crest:duration)` — not a fingerprint match. There is no Chromaprint/ACRCloud integration in practice (the `chromaprint` muxer path is attempted, but the value is never compared to a database). Meanwhile the negative branch asserts:

> «Clean gameplay & reaction audio **verified** … No sustained copyrighted music detected.»

Worse, if FFmpeg is unavailable the promise chain rejects and the `catch` returns confidence 0 with **«Audio scan completed with no copyrighted music match»** — a reassuring, false statement. I reproduced exactly this: scan-music returned "verified" while the capture endpoint simultaneously reported FFmpeg missing.

For a feature whose stated purpose is protecting users from DMCA strikes, a false "clean" verdict is the worst possible failure mode.

**Fix:** rename to "audio profile heuristic", stop claiming verification, return `unknown` when analysis cannot run, never fabricate an ID, and gate the UI copy accordingly. If real matching is required, integrate a fingerprinting service.

### 5.3 Persistence and scaling model 🟠

`db.ts:82-88` — every mutating statement ends with `raw.export()` + full-file `writeFileSync` + `rename`: the **entire database is re-serialised on every write**. Fine for 4 demo clips; it becomes quadratic I/O with real data and blocks the event loop synchronously.

Additional consequences of the single-process design: no horizontal scaling (WebSocket registry, monitor sessions, and the DB all live in `globalThis`), no restart durability for in-flight sessions (`ActiveSession` map is memory-only, so a crash loses all 20 s buffers and running jobs), and no backup/vacuum strategy.

**Fix:** move to better-sqlite3 or Postgres (the Supabase schema already exists), debounce/batch flushes, run capture workers in a separate process/queue, persist session state.

### 5.4 The capture pipeline itself is real ✅

Credit where due: `HlsRingBuffer` polls the HLS media playlist, downloads segments in parallel batches, keeps a bounded ~68 s window in `os.tmpdir()`, prunes with `unlink`, tracks seen keys, and remuxes `init.mp4 + segments` on trigger. Audio-peak measurement, chat velocity, and the hype scorer are all genuinely computed. This is the technically strongest part of the project.

Caveats: relying on Twitch's public GQL `Client-Id` and scraping YouTube/Kick pages is fragile and outside their ToS; the ring buffer gives a **bounded ~20 s pre-event** window (not "lossless 1080p60 source" in all cases — output resolution follows the broadcaster's variant), and it shells out to FFmpeg per audio probe (CPU cost per tick).

### 5.5 Documentation vs. reality

| Claim | Reality |
|---|---|
| "Full Supabase PostgreSQL schema **& RLS policies**" | `schema.sql` enables RLS on 3 tables but defines **zero policies** (grep: 0). Nothing but Auth is actually wired to Supabase. |
| "Zero API keys" | True for Twitch browse/playback via public GQL, but that is an undocumented/unofficial interface; YouTube discovery needs a key or scraping. |
| "19 REST API routes" | 20 route files. |
| "See `.env.example` / `JWT_SECRET=…`" | `.env.example` uses `CLIPX_AUTH_SECRET`; code uses `CLIPX_AUTH_SECRET`; README says `JWT_SECRET` (broken instruction → S1). |
| "No manual FFmpeg install required" | Optional dep silently missing (5.1). |
| "lossless 1920×1080@60" | Bundled demo clips are 1280×720; live output inherits the HLS variant. |
| `cd clipx-ai && npm install` | There is **no `clipx-ai/` directory in the repo** — you must unzip first. |

---

## 6. Repository hygiene & engineering practice

| Item | Status |
|---|---|
| Source in version control | ❌ only inside a binary zip; no diffs, no blame, no review |
| 18 MB zip committed | ❌ `.git` is 18 MB, no LFS, unverifiable contents |
| ~19 MB of demo video/posters | ⚠️ committed binaries; should be LFS/release assets/CDN |
| LICENSE | ❌ none (public repo with no rights granted) |
| Tests | ❌ none (`*.test.*`, jest/vitest/playwright absent) |
| CI/CD | ❌ no `.github/`, workflows, Dependabot, CodeQL |
| Lint/format | ❌ no ESLint/Prettier/Biome config (TS `strict: true` ✅) |
| `.env.example` / `.gitignore` | ✅ present and sensible (DB, exports, uploads ignored) |
| Secrets in history | ✅ none found |
| Sandbox leakage | ⚠️ `next.config.mjs` ships `allowedOrigins: ["*.e2b.app", …]` and unused `serverActions` config — an artifact of the environment it was generated in |
| Commit quality | ⚠️ 3 commits, all "Add files via upload"; no meaningful history |

### Code quality

* **Strengths:** strict TS with **zero `as any`**, **zero TODO/FIXME**, zero `console.log` left in `src`, consistent naming, good use of `lib/` separation, thoughtful UI (Tailwind + components), `stripInternalClipPaths` shows real attention to not leaking server paths to clients.
* **Weaknesses:** monolithic files (`monitor-engine` 2,070 / `live-sources` 1,890 / `monitoring/page.tsx` 1,920 / `editor/page.tsx` 1,373 lines) mixing HTTP, filesystem, FFmpeg and business rules. **52 bare `catch {}` blocks** swallow failures — which is exactly how 5.1 and 5.2 stayed invisible. Status strings are ad-hoc unions rather than a typed state machine. No shared API client on the frontend (13 hand-rolled `fetch('/api/…')`).

---

## 7. Prioritized remediation plan

### P0 — before this is reachable by anyone but you (hours)
1. **Remove the JWT fallback secret**; throw at boot if unset. Unify on one env var name and fix `README.md` + `.env.example`.
2. **Add stream ownership checks** to PATCH/DELETE/trigger and clip scan-music (reuse `canUserExportClip`-style helper) — and stop returning/acting on `user_id IS NULL` streams for destructive verbs.
3. **Require authentication** for uploads and settings writes; stop aliasing guests to `user-demo`.
4. **Upgrade Next.js** to ≥15.5.24 and patch postcss/zod (`npm audit fix` + regression test).

### P1 — before showing it to users (days)
5. FFmpeg health check at startup; hard dependency or loud failure; block capture UI when missing.
6. Make the music scan honest: return `unknown` on failure, drop the fake acoustic ID and "verified" copy.
7. Rate limiting + quotas (login, upload, discover, capture); cap concurrent sessions/jobs; clean upload dir.
8. `secure` cookies, real CORS policy, security headers (CSP/HSTS/X-Frame-Options), authenticated + origin-checked WebSocket with per-user event filtering (S7).
9. Encrypt or externalise platform tokens; document the plaintext risk meanwhile.

### P2 — before calling it a product (weeks)
10. **Publish real source**: delete the zip, commit `src/`, `scripts/`, `public/` (media via LFS/release), keep root config only if used.
11. Add `LICENSE`, `SECURITY.md`, CI (typecheck + build + audit), Dependabot, ESLint/Prettier.
12. Add tests: scoring unit tests, auth/session, ownership matrices, media-route traversal, an integration test for demo login → clip list.
13. Replace the whole-file sql.js flush with a real database; move capture into a worker; persist sessions.
14. Split the 2k-line modules; replace bare `catch {}` with logged, typed failures.
15. Fix the README claims table above; document Node versions in `engines`; remove `*.e2b.app` from committed config.

---

## 8. Appendix — how to verify this review

```bash
# 1. Source is only inside the zip
unzip -l clipx-ai-project6.zip | tail -3          # 76 files, 19.3 MB uncompressed
cmp package.json <(unzip -p clipx-ai-project6.zip clipx-ai/package.json)   # identical

# 2. It builds and runs
mkdir -p /tmp/clipx && cd /tmp/clipx && unzip -q /path/clipx-ai-project6.zip
cd clipx-ai && npm install && npm run build && PORT=3100 npm start

# 3. FFmpeg optional dep is missing → capture fails
npm outdated | grep ffmpeg                        # ffmpeg-static  MISSING
curl -X POST localhost:3100/api/streams/stream-demo-sandbox/trigger -d '{}' -H 'content-type: application/json'
# → {"error":"FFmpeg not found (spawn ffmpeg ENOENT)…"}

# 4. Music scan claims verification without analysis
curl -X POST localhost:3100/api/clips/clip-demo-1/scan-music
# → "Clean gameplay & reaction audio verified (−42 dB … ID #…)" despite no FFmpeg

# 5. Session forgery (start the server WITHOUT CLIPX_AUTH_SECRET)
node -e 'const{SignJWT}=require("jose");new SignJWT({sub:"user-demo"})
  .setProtectedHeader({alg:"HS256"}).setIssuedAt().setExpirationTime("14d")
  .sign(new TextEncoder().encode("clipx-ai-studio-hmac-session-key-2026-v1"))
  .then(console.log)' > /tmp/t
curl -H "Cookie: clipx_session=$(cat /tmp/t)" localhost:3100/api/auth/me   # 200 + account

# 6. Dependency risk
npm audit --omit=dev                              # 1 critical (next), 2 high (postcss, zod)

# 7. Supabase overclaim
grep -ic policy supabase/schema.sql               # 0
```

---

### Closing assessment

The engineering underneath CLIPX AI is better than the packaging suggests: a working HLS ring-buffer capture engine, real FFmpeg compositing with ASS captions, a coherent schema, and a detailed UI — built by someone who understands the domain. But the repo presents it as a v1.4.0 SaaS ("zero config, production-ready") while shipping a forgeable auth secret, unauthorised destructive endpoints, anonymous writes, a half-missing media toolchain, a copyright check that can falsely clear content, and a framework with critical RCEs. **Treat it as an impressive prototype: local demo only, until P0 is done.**

---

## 9. Remediation log — v1.5.0 (2026-11-17)

The P0/P1 items below were implemented on branch `arena/5af5ddc6-al-cuts` and verified against a live build (Next.js 15.5.29, real FFmpeg, `npm run smoke` → 18/18).

### Repository hygiene
- **Source is now in the repository**: `src/`, `scripts/`, `public/`, `supabase/` live at the root; `clipx-ai-project6.zip` was removed. `npm install && npm run dev` works from a fresh clone.
- Root config is byte-identical to what was inside the zip, so no behaviour changed by the move.

### P0 fixes (all verified)
| Finding | Fix | Evidence |
|---|---|---|
| S1 forgeable sessions | Removed the hardcoded fallback. `CLIPX_AUTH_SECRET`/`JWT_SECRET` (≥32 chars) or a generated `data/auth-secret` (0600) key | forged legacy token → `/api/auth/me` returns `user: null` |
| S2 missing stream authorization | `canModifyStream` / `canTriggerStream` / `canReadStream` in `lib/auth.ts`, applied to PATCH, DELETE, trigger; `scan-music` reuses `canUserExportClip` | owner B → 403 on A's stream; anonymous → 401; owner → 200 |
| S3 anonymous writes | Streams, uploads and settings now require authentication; guest settings no longer alias to `user-demo` | guest POST stream/settings/upload → 401 |
| S4 vulnerable framework | Next 14.2.35 → **15.5.29**, postcss → 8.5.33, zod → 4.6.7; async `cookies()`/route-params migration; `serverExternalPackages` + `allowedDevOrigins` for the custom server | `next build` clean, `npm audit --omit=dev` clean |

### P1 fixes
- **FFmpeg visibility:** `GET /api/health` reports binary presence/version (`503` when unusable); `server.mjs` probes it at boot and prints a clear warning; `describeMediaToolchain()` in `lib/ffmpeg.ts`; binary resolution no longer makes the bundler emit warnings.
- **Honest music scan:** removed the fabricated "Acoustic ID", relabelled output as a signal-level heuristic, and an unusable scan now returns *"Audio analysis unavailable — NO copyright check was performed"* instead of a false "clean".
- **Rate limiting:** `lib/rate-limit.ts` (per-IP fixed window) on login, register, demo login, upload, stream connect, capture and discovery; verified `429` on the 9th bad login.
- **Headers/cookies:** `Secure` cookies when the request is HTTPS; wildcard CORS removed; `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production.
- **Docs/config:** `.env.example` and README rewritten to one canonical variable list (`CLIPX_AUTH_SECRET`, `CLIPX_PUBLIC_URL`, `CLIPX_DISABLE_DEMO_ACCOUNT`, `FFMPEG_PATH`, `FFPROBE_PATH`); README claims corrected (21 routes, heuristic music check, real Supabase RLS policies); `engines.node` added; demo-account kill switch; `SECURITY.md` added.
- **Supabase schema:** added 14 ownership RLS policies (previously RLS was enabled with none).
- **Tests:** `npm run smoke` (`scripts/smoke-test.mjs`) asserts pages, media range serving, traversal blocking, session forgery, anonymous writes, demo read-only, and rate limiting.

### Still open (unchanged from §7 P2)
- `/api/ws` still broadcasts every stream's events to every client (per-user filtering needs an authenticated WS handshake).
- `sql.js` full-file rewrite per write; in-memory sessions; no worker/queue.
- Platform tokens remain unencrypted in SQLite.
- No LICENSE, ESLint/Prettier, or CI (recommend adding a workflow running `npm run build && npm run smoke`).
- 52 bare `catch {}` blocks and the 2k-line modules are untouched.
