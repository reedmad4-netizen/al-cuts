# CLIPX AI — AI-Powered Automatic Gaming Clip Generator (v1.6.0)

**CLIPX AI** is a full-stack SaaS web application that connects to **any public Twitch, YouTube Live, Kick, or HLS (`.m3u8`) gaming stream in native `1080p60 (Source)` quality with ZERO API keys** (plus local video uploads), maintains a **live rolling 20-second pre-event buffer**, streams **real-time live viewer chat**, detects viral gameplay hype spikes, scores highlights **0–100**, and **automatically generates & downloads BOTH a lossless `1920×1080 @ 60fps` Original MP4 AND a full-length, full-frame `1080×1920 @ 60fps` Vertical Short MP4** (up to full 60s Shorts length, nothing cropped off) — pausing auto-download with a warning if copyrighted music is detected (audio never modified without permission).

Built to run out of the box on **Windows 10/11 (CMD & PowerShell)**, **macOS**, and **Linux** across **Node.js 18, 20, 22, 24, 25, and 26+** — **no API keys, no Python, no `yt-dlp`, no Visual Studio C++ Build Tools, and no manual FFmpeg installation required**.

---

## Quick Start (Windows / macOS / Linux)

Requires **Node.js 18.18+**. The WebAssembly SQLite database (`sql.js`) is a normal dependency; the static `ffmpeg`/`ffprobe` binaries are **optional dependencies** and can be skipped by npm on some networks — check `curl localhost:3000/api/health` after boot.

```bash
npm install
npm run dev
```

Then open **http://localhost:3000** in your browser.

### Verify the install

```bash
curl -s localhost:3000/api/health | jq
# {"ok":true, ..., "media":{"ready":true, "ffmpeg":{...}, "ffprobe":{...}}}

npm run smoke     # 21 HTTP checks: pages, auth, ownership, traversal, rate limits
```

If `/api/health` reports `media.ready: false`, clip capture/editing is disabled:

- install FFmpeg + FFprobe on your `PATH`, **or**
- set `FFMPEG_PATH` / `FFPROBE_PATH`, **or**
- reinstall with optional binaries: `npm install --include=optional`

The server prints the same warning at boot — it will never silently pretend video processing works.

### Production Build & Start (Optional)

```bash
npm run build
npm start          # serves the compiled app on http://localhost:3000
```

Both commands work on the same codebase: `npm run dev` compiles pages on demand
(recommended while editing), `npm start` requires the build and is what you
deploy. Change the port with `PORT=8080 npm start`.

### Where state lives

Everything is local and git-ignored — delete these directories to start fresh:

| Path | Contents |
|---|---|
| `data/clipx.db` | users, streams, clips, settings, publishing history (SQLite via sql.js) |
| `data/auth-secret` | signing key generated on first boot (set `CLIPX_AUTH_SECRET` to override) |
| `media/`, `exports/` | captured footage, rendered clips and shorts |

Running two instances against the same SQLite file is not supported — the
database is rewritten as a whole file on each write.

### Demo Account

- **Email:** `demo@clipx.ai`
- **Password:** `DemoClipX2026!`
- *(Or click **1-Click Demo Login** on `/auth`, or create your own account.)*

> The demo account is **shared by everyone** who can reach the instance. Set
> `CLIPX_DISABLE_DEMO_ACCOUNT=true` on any public deployment.

### Security model (v1.5.0)

- **Sessions** are HS256 JWTs in an HttpOnly, SameSite=Lax cookie; the cookie is
  marked `Secure` automatically when the request arrives over HTTPS.
- **No signing secret is baked into the source.** `CLIPX_AUTH_SECRET` (or
  `JWT_SECRET`) is used when set — at least 32 characters — otherwise a unique
  key is generated on first boot at `data/auth-secret` (mode `0600`,
  git-ignored). Set it explicitly for multi-instance deployments.
- **Every mutating route requires authentication and ownership**: connecting a
  stream, uploading footage, changing settings, retuning/stopping/deleting a
  stream, and capturing clips are all scoped to the signed-in owner. Only the
  bundled demo sandbox is triggerable by guests, and it is never writable.
- **Rate limits** are applied to login, registration, demo login, uploads,
  stream connections, captures and discovery.
- **Media** is served from a single guarded route; traversal attempts return 403.
- **Dependencies** are on Next.js 15.5 (patched for the RCE advisories that
  affect 14.2.x) with a clean production `npm audit`.

See [`ANALYSIS.md`](./ANALYSIS.md) for the full review and the items still open.

---

## Clipping Other Creators' Public Live Streams (Zero API Keys)

Open **Live Monitoring (`/monitoring`)** and either:
- **Click any card** under **"Live Gaming Streams Right Now"** (real-time Twitch & YouTube Live broadcasts — filter by `VALORANT`, `Counter-Strike`, `Fortnite`, `League of Legends`, `Apex Legends`, `GTA V`, `Minecraft`, or search any game), **or**
- **Paste any live stream URL or username** in **Connect Any Live Stream**:
  - **Twitch:** `https://www.twitch.tv/shroud` or simply `shroud` — captures live 720p HLS into a continuous 20-second rolling buffer + connects to live Twitch IRC chat anonymously (`0` API keys)
  - **YouTube Live:** `https://www.youtube.com/watch?v=...`, `https://www.youtube.com/live/...`, or `@ChannelHandle` — captures live 720p DVR/HLS rolling 20-second window + polls real YouTube Live Chat (`0` API keys)
  - **Kick:** `https://kick.com/username` or `username` — resolves live HLS `playback_url` + live Pusher chat on home networks (`0` API keys; if Cloudflare blocks a network, paste the `.m3u8` `playback_url` directly)
  - **Direct HLS / MP4:** any public `.m3u8` or `.mp4` URL

Once connected:
1. CLIPX AI keeps the **last 20 seconds** continuously buffered and tracks a real-time **Live Hype Index (`0–100`)** from viewer chat velocity (`msg/min`), hype keywords (`CLIP IT`, `ACE`, `CLUTCH`, `OMG`, `NO WAY`, `INSANE`, etc.), and live audio peaks.
2. **1080p60 Source Quality & Full-Length, Full-Frame Shorts (Upgraded in v1.4.0):** The moment Live Hype reaches your configurable **Hype Threshold** (`30–95`), CLIPX AI automatically:
   - Saves a **lossless `1920×1080 @ 60fps` Original `16:9` MP4** (bit-exact H.264 High Profile stream-copy from the broadcaster's `1080p60 (source)` feed + untouched 48kHz AAC audio; also offers `1080p60 High` and `720p60 HD` modes),
   - Renders a paired **Full HD `1080×1920 @ 60fps` Vertical Short MP4** (Lanczos scaling + subtle unsharp detail filter, H.264 High Profile CRF 18, lossless AAC audio copy) covering:
     - **100% Full Clip Duration** (`0.00s → end`, configurable up to a **full `60s` Short** via `28s` / `45s` / `60s Full` presets), and
     - **100% Full Widescreen Frame** (`Full Frame HD + Blurred Canvas` default so facecam, minimap, HUD, crosshair, and killfeed are all visible with zero cut-off edges; plus `Facecam Split` and `9:16 Zoom` options), with headline above and timed subtitles below so zero gameplay is covered,
   - **Auto-saves BOTH files** side-by-side in `clipx-ai/exports/` (`..._ORIGINAL_16x9.mp4` + `..._SHORT_9x16.mp4`) **and auto-downloads BOTH** straight to your browser's Downloads folder,
   - **Copyright Safety Guard:** A local audio heuristic (mid-band RMS vs. transient crest — **not** a fingerprint database) flags a possible music bed, and automatic download pauses and shows a warning modal so you can click **I Understand — Download Both (16:9 + 9:16)**, **Open Editor**, or **Skip Auto-Download (Keep Saved)** — original audio is never modified automatically.
   - Applies duplicate-prevention cooldown and keeps monitoring for the next hype moment automatically.
3. Click **Clip Now (Save 16:9 + 9:16 Short)** anytime for an instant manual dual capture, or fine-tune any clip in the **Studio Video Editor (`/editor`)**.

*(Always respect broadcaster permissions, fair-use laws, and platform terms when exporting or reposting clips from other creators' channels.)*

---

## Tech Stack

- **Frontend:** Next.js 14.2.35 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend:** Custom Node.js HTTP + WebSocket Server (`server.mjs`, `/api/ws`) + 21 REST API routes (including `/api/health`)
- **Database:** Pure WebAssembly SQLite (`sql.js`, persisted to `data/clipx.db` — zero native C++/`node-gyp` build dependencies) + Supabase PostgreSQL schema with ownership RLS policies in `supabase/schema.sql`
- **Video & Audio Processing:** FFmpeg + FFprobe (automatically uses system `ffmpeg`/`ffprobe` if on `PATH`, or bundled `ffmpeg-static` + `ffprobe-static` binaries)
- **Authentication:** `bcryptjs` password hashing + `jose` signed HttpOnly JWT cookies + optional Supabase Auth dual-sync

---

## Features & Pages

1. **Landing Page (`/`)** — Product overview, interactive live studio card, 5-signal AI scoring breakdown, feature grid, compliance banner
2. **Dashboard (`/dashboard`)** — Real metrics (distinct real vs. demo stream counters), quick 20s clip trigger, top-ranked highlights, live WebSocket chat telemetry, recent exports
3. **Live Stream Monitoring (`/monitoring`)** — Connect Twitch / YouTube / Kick (honest live API verification — never fakes a connection), direct `.m3u8`/`.mp4` streams, upload your own `.mp4`/`.webm`/`.mov` footage, or launch the clearly labeled `[DEMO SANDBOX]`
4. **Clip Library (`/clips`)** — Search, filter by scope (`All` / `My Clips` / `Demo`), aspect ratio, and copyright status; sort by AI score, newest, or duration; video preview modal + 1-click actions
5. **Studio Video Editor (`/editor`)** — Trim start/end, crop to `9:16` Shorts/TikTok/Reels, `16:9` YouTube, or `1:1` Square with horizontal pan, burn headline captions + timed subtitles via FFmpeg (`libass`), and opt-in audio mute
6. **Live Chat Monitor (`/chat`)** — WebSocket-streamed chat feed, live velocity indicator (`msg/min`), interactive message tester, and surge log showing both saved clips and duplicate-suppressed bursts
7. **Downloads & Export Log (`/downloads`)** — Ready-to-export owned clips with real XHR download progress bar, pre-export copyright warning modal (never auto-strips audio), and persistent export history
8. **Settings (`/settings`)** — Post-event capture duration (`5–15s`), minimum AI score threshold, duplicate cooldown window, chat spike multiplier, copyright warning preferences, official Twitch/YouTube/Kick API keys, and demo data reset
9. **Publishing (`/publishing`)** — Connect an Instagram Business/Creator account + S3-compatible bucket, verify both, publish a Short as a Reel in one click, or switch on hands-free auto-publish with per-stream overrides and a publishing history
10. **Login & Register (`/auth`)** — Sign in, create an account, or use 1-Click Demo Login

---

## Automatic Instagram Reels Upload (optional)

CLIPX AI can push every generated **9:16 Short** straight to Instagram Reels —
manually with one click, or fully hands-free.

> **Account requirement:** Instagram's publishing API works **only** for
> **Business / Creator** accounts linked to a Facebook Page. Personal accounts
> have no supported publishing API. The unofficial private-API workarounds
> violate Instagram's Terms of Use and can get an account banned, so CLIPX AI
> deliberately does not implement them — instead the Publishing page tells you
> exactly what to change if it detects a personal account.

### Why a bucket is involved

Instagram never accepts a file upload: it **downloads the video from a public
URL**. CLIPX AI therefore uploads the rendered Short to your own S3-compatible
bucket and hands Instagram a link.

### 1. Prepare the Instagram account

1. Convert the account to **Creator** or **Business** (Instagram app →
   Settings → Account type).
2. Link it to a Facebook Page (required by the API).
3. Create a Meta app at [developers.facebook.com](https://developers.facebook.com),
   add the **Instagram** product, and request `instagram_basic` +
   `instagram_content_publish` (+ `pages_show_list` to read the Page).
4. Find the Instagram user id:
   `GET /me/accounts` → take a Page id → `GET /{page-id}?fields=instagram_business_account`.
5. Generate a **long-lived** user access token (exchange the short-lived one via
   `GET /oauth/access_token?grant_type=fb_exchange_token`). Tokens last ~60 days.

### 2. Prepare the bucket

Works with AWS S3, Cloudflare R2, Backblaze B2 or MinIO. Either make the bucket
publicly readable (and set a CDN base URL) or leave that field blank — CLIPX AI
then issues **presigned links valid for 24 h**.

### 3. Configure CLIPX AI

Open **Publishing** in the sidebar and fill in:

| Field | Example |
|---|---|
| Instagram user ID | `17841400000000000` |
| Long-lived access token | `EAAG…` (stored server-side, never returned to the browser) |
| Hashtags | `#gaming #gamingclips #reels` |
| Endpoint | `https://<account>.r2.cloudflarestorage.com` |
| Region | `auto` for R2, e.g. `us-east-1` for AWS |
| Bucket / prefix | `clipx-clips` / `clipx` |
| Access key id + secret | your bucket credentials |

Press **Verify connection** (checkout the account type and remaining daily
quota) and **Test bucket** (uploads a tiny object and downloads it back through
the public URL). Both must pass before publishing.

Prefer environment variables on a shared deployment:

```bash
IG_USER_ID=17841400000000000
IG_ACCESS_TOKEN=EAAG...
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=clipx-clips
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PREFIX=clipx
S3_PUBLIC_BASE_URL=          # optional CDN / public bucket
```

### 4. Choose how clips are published

- **Manual** (default): the Publishing page lists your Shorts with an editable
  auto-generated caption and a **Publish to Instagram** button.
- **Auto-publish**: enable the toggle to publish each new Short the moment it is
  rendered. Any stream can override the account default (inherit / always /
  never).

Captions are generated locally from the clip's own data — title, game, channel,
AI hype score and trigger reason plus your hashtag set — no extra AI service.

### Limits and behaviour

- Instagram allows **50 API-published posts per rolling 24 h**; CLIPX AI checks
  the account quota *and* its own history before publishing.
- Every video is validated against Reels rules (MP4 · H.264/HEVC · AAC · 3–900 s
  · ≤1 GB · vertical preferred) **before** anything is uploaded.
- Publishing state is tracked per clip (`queued → hosting → creating →
  processing → published/failed`) and streamed to the UI over the WebSocket.
- Failures are recorded with Meta's error explained in plain language (expired
  token, missing permission, unreachable URL, rate limit, non-professional
  account, unsupported video).
- Only clips you own can be published. Demo sample clips belong to the demo
  account, so sign in to publish them.

### Verifying it works without Instagram

The publish pipeline is covered by an offline test harness that stands up a mock
Graph API and a mock S3 bucket:

```bash
npm run test:s3        # SigV4 differential test vs the aws4 package
npm run test:social    # full publish flow + hands-free auto-publish
```

`test:social` needs the server running with
`IG_GRAPH_BASE_URL=http://127.0.0.1:3900/graph` and a working FFmpeg.

---

## Environment Variables

Everything is optional for local development — copy `.env.example` to `.env.local`
if you want to pin values.

```bash
# Session signing key. REQUIRED for multi-instance deployments.
# Must be at least 32 characters. If unset, a unique key is generated at
# data/auth-secret on first boot (single-instance convenience only).
CLIPX_AUTH_SECRET=

PORT=3000

# Set when the app is served over HTTPS behind a proxy (used for secure cookies)
CLIPX_PUBLIC_URL=

# Disable the shared demo account on public deployments
CLIPX_DISABLE_DEMO_ACCOUNT=false

# Optional Supabase Auth dual-sync (run supabase/schema.sql in your SQL editor)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Optional official streaming platform APIs (can also be set on /settings)
TWITCH_CLIENT_ID=
TWITCH_ACCESS_TOKEN=
YOUTUBE_API_KEY=
KICK_API_TOKEN=

# Optional explicit media binaries (auto-detected otherwise)
FFMPEG_PATH=
FFPROBE_PATH=
```

`JWT_SECRET` is still accepted as an alias for `CLIPX_AUTH_SECRET` for
backwards compatibility, but the two must not disagree.

> Note: platform API tokens entered on `/settings` are stored **unencrypted**
> in `data/clipx.db`. Treat that file as a secret, or keep credentials in the
> environment instead.

## Troubleshooting on Windows

If you previously extracted v1.0, delete the old folder (or delete `node_modules` and `package-lock.json`) before running `npm install` in the new folder:

```powershell
cd clipx-ai
npm install
npm run dev
```
