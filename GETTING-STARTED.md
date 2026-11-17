# Getting started — Instagram posts in two steps

The goal is simple: **Shorts you generate here appear on Instagram by themselves.**

There are two setup steps. Everything else is optional.

| Step | What you do | Time |
|---|---|---|
| [1](#step-1--run-the-app) | Run the app | 5 min |
| [2](#step-2--connect-instagram) | Click **Connect Instagram** | 2 min |
| [Optional](#optional-settings-you-may-want) | Hashtags, auto-publish, bucket | 2 min |

You do **not** need a bucket, an S3 account, or to hunt for account IDs. The app
serves the videos itself and fetches the account ID for you.

---

## Before you start (once)

1. **Node.js 18.18+** — [nodejs.org](https://nodejs.org), the LTS button. Check:
   `node -v`.
2. **Instagram account set to professional.** In the Instagram app: profile →
   ☰ → *Settings and activity* → *Account type and tools* → **Switch to
   professional account** → pick **Creator** or **Business**.
   Personal accounts cannot post through any API — that is Instagram's rule, not
   the app's.
3. **A Meta app** (free, 2 minutes):
   - [developers.facebook.com](https://developers.facebook.com) → **My Apps** →
     **Create app** → use case **Instagram** → type **Business**.
   - Open **Instagram → API setup with Instagram login**.
   - Under **Permissions**, tick `instagram_business_basic` and
     `instagram_business_content_publish`.
   - Copy the **App ID** and **App Secret** from *App settings → Basic*.

---

## Step 1 — Run the app

```bash
git clone https://github.com/reedmad4-netizen/al-cuts.git
cd al-cuts
git checkout arena/5af5ddc6-al-cuts
npm install
npm run dev
```

Open **http://localhost:3000** → **1-Click Demo Login** (or
`demo@clipx.ai` / `DemoClipX2026!`).

Check the media toolchain once:

```bash
curl -s localhost:3000/api/health
```

`"ok":true` and `"media":{"ready":true}` means video capture and rendering work.
If `ready` is `false`: `npm install --include=optional`, or set `FFMPEG_PATH` /
`FFPROBE_PATH` to an FFmpeg you already have.

> In Arena the app is already running on port 3100 — skip this step.

---

## Step 2 — Connect Instagram

1. Sidebar → **Publishing** → **Setup** card → **Connect Instagram**.
2. If the button says it needs app credentials, open
   **Advanced — one-click Meta app credentials**, paste the **App ID** and
   **App Secret** from the Meta dashboard, press **Save**, then press
   **Connect Instagram** again.
3. Instagram asks you to approve. Accept — it grants only posting for your own
   account.
4. You land back on Publishing with **Instagram connected**.

What just happened: the app asked Meta for permission, Meta returned your
account id automatically, and the app exchanged the one-hour token for a
**60-day** one. You never typed an id or a token.

5. Press **Test connection** → you should see `@yourhandle`, the account type and
   the remaining daily posts.
6. Press **Test hosting** → it downloads a real clip through the app's own URL,
   exactly as Instagram will.

Both green means you are done. **Every generated Short now has a
*Publish to Instagram* button**, and you can switch on hands-free posting.

### Make it hands-free

On the same page: tick **Auto-publish every generated Short** → **Save**. New
Shorts post themselves as soon as they render. Individual streams can be set to
*Always* / *Never* under **Per-stream overrides**.

### Try it end to end

1. **Monitoring** → open a stream → trigger a capture (the demo sandbox works).
2. Wait for the Short under **Clips**.
3. **Publishing** → the Short appears with an editable caption → **Publish to
   Instagram** (or wait for it to post itself if auto-publish is on).
4. The status moves *hosting → creating → processing → published*, then a
   permalink appears. Instagram needs 10–60 s to process a Reel.

---

## Where videos are hosted (default: here)

Instagram never accepts a file upload — it downloads from a URL. The app serves
each Short itself at a signed link that expires in 24 h, so nothing else is
needed.

One catch: **Instagram must be able to reach that URL.** While you are on
localhost you can test the flow, but Meta cannot download from `localhost`. When
you deploy (VPS, Render, Fly, Railway, a tunnel…), open **Video hosting** in the
app once and press **Use current address**, or set `PUBLIC_BASE_URL`; it saves
the HTTPS address you are browsing from.

Prefer a bucket (many uploads, slow proxy, CDN)? Switch **Video hosting** to
**S3-compatible bucket** and paste endpoint, region, bucket, access key and
secret (AWS S3, Cloudflare R2, Backblaze B2, MinIO all work). Then **Test
hosting**.

---

## Optional settings you may want

| Setting | Where | Default |
|---|---|---|
| Hashtags appended to captions | Publishing → caption field | `#gaming #gamingclips #reels #clipxai` |
| Show Reel in the main feed | Publishing → checkbox | on |
| Auto-publish on/off | Publishing → checkbox | off |
| Per-stream override | Publishing → Per-stream overrides | follow account |
| Token refresh | Publishing → **Refresh token** | auto every ~60 days if you press it |

Edit any caption before posting: the caption box on each clip card is
pre-filled and saved with the post.

---

## Everyday use

| Task | Where |
|---|---|
| See what was posted | Publishing → **Publishing history** |
| Re-post a clip | Publishing → clip card → **Republish Reel** |
| Pause auto-posting | untick **Auto-publish** → Save |
| Keep the token alive | **Refresh token** (Instagram Login only) |

---

## Troubleshooting

| Message | Meaning | Fix |
|---|---|---|
| *Connect needs a Meta app id and secret* | Advanced credentials empty | Paste App ID + App Secret, Save |
| *This is a personal Instagram account* | Meta refuses personal accounts | Switch the account to Creator/Business |
| *Token expired / invalid OAuth token* | 60 days passed | **Reconnect**, or **Refresh token** |
| *Missing permission / (#10)* | Scopes were not granted | Tick the two `instagram_business_*` permissions, reconnect |
| *Redirect URI mismatch* | Meta app redirect list does not include the app URL | Meta dashboard → Instagram Login → add `<your-public-url>/api/social/instagram/oauth/callback` |
| *Test hosting: cannot reach …/api/health* | The public URL is wrong, or the internet cannot reach this machine | Fix **Video hosting → public address**; deploy or tunnel first |
| *Video does not meet Reels requirements* | Not MP4/H.264, wrong length/size | Use the app's own Shorts — it renders compliant files |
| *Rate limit / quota* | ~50 posts per 24 h | Wait, or slow auto-publishing |
| Stuck on *processing* | Instagram could not download the video | Run **Test hosting**; keep the app publicly reachable |

---

## What this app will not do

- **Post to a personal Instagram account.** No API exists for it. Tools that
  claim otherwise drive Instagram's private app API against its Terms of Use and
  risk bans; this app tells you what to change instead.
- **Upload the file directly to Instagram.** It has no upload endpoint.
- **Guarantee every post succeeds.** Meta's processing can fail for reasons
  outside the app (network, transient 500s). Each attempt keeps Meta's own error
  text so you can see why.

---

## Commands

```bash
npm run dev                  # develop
npm run build && npm start   # production
npm run smoke                # 21 HTTP checks (server must be running)
npm run test:s3              # S3 signing correctness
npm run test:social          # 34 checks: publish, hosting, OAuth, refresh, auto-post
```

`test:social` talks to its own mock Meta API and mock bucket, never your account.
Start the server with the mock URLs shown in the README for that run.
