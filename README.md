# CLIPX AI — AI-Powered Automatic Gaming Clip Generator (v1.4.0)

**CLIPX AI** is a full-stack SaaS web application that connects to **any public Twitch, YouTube Live, Kick, or HLS (`.m3u8`) gaming stream in native `1080p60 (Source)` quality with ZERO API keys** (plus local video uploads), maintains a **live rolling 20-second pre-event buffer**, streams **real-time live viewer chat**, detects viral gameplay hype spikes, scores highlights **0–100**, and **automatically generates & downloads BOTH a lossless `1920×1080 @ 60fps` Original MP4 AND a full-length, full-frame `1080×1920 @ 60fps` Vertical Short MP4** (up to full 60s Shorts length, nothing cropped off) — pausing auto-download with a warning if copyrighted music is detected (audio never modified without permission).

Built to run out of the box on **Windows 10/11 (CMD & PowerShell)**, **macOS**, and **Linux** across **Node.js 18, 20, 22, 24, 25, and 26+** — **no API keys, no Python, no `yt-dlp`, no Visual Studio C++ Build Tools, and no manual FFmpeg installation required**.

---

## Quick Start (Windows / macOS / Linux)

Only **Node.js 18+** is required. Everything else — the WebAssembly SQLite database (`sql.js`) and static `ffmpeg` + `ffprobe` binaries (`ffmpeg-static`, `ffprobe-static`) — installs automatically via `npm install`.

```bash
cd clipx-ai
npm install
npm run dev
```

Then open **http://localhost:3000** in your browser.

### Production Build & Start (Optional)

```bash
npm run build
npm start
```

### Demo Account

- **Email:** `demo@clipx.ai`
- **Password:** `DemoClipX2026!`
- *(Or click **1-Click Demo Login** on `/auth`, or create your own account.)*

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
   - **Copyright Safety Guard:** If potentially copyrighted music is detected, automatic download pauses and shows a warning modal so you can click **I Understand — Download Both (16:9 + 9:16)**, **Open Editor**, or **Skip Auto-Download (Keep Saved)** — original audio is never modified automatically.
   - Applies duplicate-prevention cooldown and keeps monitoring for the next hype moment automatically.
3. Click **Clip Now (Save 16:9 + 9:16 Short)** anytime for an instant manual dual capture, or fine-tune any clip in the **Studio Video Editor (`/editor`)**.

*(Always respect broadcaster permissions, fair-use laws, and platform terms when exporting or reposting clips from other creators' channels.)*

---

## Tech Stack

- **Frontend:** Next.js 14.2.35 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend:** Custom Node.js HTTP + WebSocket Server (`server.mjs`, `/api/ws`) + 19 REST API routes
- **Database:** Pure WebAssembly SQLite (`sql.js`, persisted to `data/clipx.db` — zero native C++/`node-gyp` build dependencies) + full Supabase PostgreSQL schema & RLS policies in `supabase/schema.sql`
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
9. **Login & Register (`/auth`)** — Sign in, create an account, or use 1-Click Demo Login

---

## Optional Environment Variables

Copy `.env.example` to `.env.local` if you want to configure custom secrets, Supabase, or platform API keys via environment variables (you can also enter Twitch/YouTube/Kick API credentials directly on the `/settings` page):

```bash
JWT_SECRET=replace-with-a-random-32-char-secret
PORT=3000

# Optional Supabase dual-sync (run supabase/schema.sql in your Supabase SQL editor)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Optional Official Streaming Platform APIs
TWITCH_CLIENT_ID=
TWITCH_ACCESS_TOKEN=
YOUTUBE_API_KEY=
KICK_API_TOKEN=

# Optional custom FFmpeg/FFprobe binary paths (auto-detected otherwise)
FFMPEG_PATH=
FFPROBE_PATH=
```

---

## Troubleshooting on Windows

If you previously extracted v1.0, delete the old folder (or delete `node_modules` and `package-lock.json`) before running `npm install` in the new folder:

```powershell
cd clipx-ai
npm install
npm run dev
```
