# Getting started — from zero to auto-posting Reels

This is the slow, explicit version. Follow it top to bottom; each part ends with
something you can check before moving on. Total time: ~15 minutes for a first
run, ~10 extra minutes to connect Instagram.

There are five parts:

| Part | What you do | Time |
|---|---|---|
| [1](#part-1--run-the-app-on-your-computer) | Run the app on your computer | 5 min |
| [2](#part-2--make-your-instagram-account-able-to-post-via-api) | Make your Instagram account API-postable | 2 min |
| [3](#part-3--create-a-meta-app-and-get-a-token) | Create a Meta app + get a token | 5 min |
| [4](#part-4--create-a-free-bucket-for-the-video-files) | Create a free bucket for the files | 5 min |
| [5](#part-5--connect-everything-inside-the-app) | Connect everything in the app | 3 min |

---

## Part 1 — Run the app on your computer

You need **Node.js 18.18 or newer** ([nodejs.org](https://nodejs.org), pick the
LTS button). To check what you have:

```bash
node -v     # must print v18.18.0 or higher (v20 / v22 are best)
```

Then:

```bash
git clone https://github.com/reedmad4-netizen/al-cuts.git
cd al-cuts
git checkout arena/5af5ddc6-al-cuts
npm install
npm run dev
```

`npm install` downloads the app plus optional static FFmpeg binaries. If your
network blocks those, don't worry — Part 1 ends with a check that tells you.

Open **http://localhost:3000** and sign in with:

- **Email:** `demo@clipx.ai`
- **Password:** `DemoClipX2026!`
- or just click **1-Click Demo Login**.

### Check before moving on

In a second terminal:

```bash
curl -s localhost:3000/api/health
```

You want **`"ok":true`** and **`"ready":true`** inside `media`.

If `media.ready` is `false`, video capture and rendering are switched off. Fix it
whichever way suits you:

```bash
npm install --include=optional           # 1. pull the bundled binaries
# 2. or install FFmpeg yourself and point at it:
FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe npm run dev
# 3. or (Windows) choco install ffmpeg   /  (macOS) brew install ffmpeg
```

The app never pretends video works when it doesn't — that's why this check
exists.

> **Using the live preview in Arena instead?** It is already running on port
> 3100. Same login, same pages — you can skip Part 1 entirely.

---

## Part 2 — Make your Instagram account able to post via API

Instagram only allows **professional** accounts to publish through its API.
Personal accounts are refused by Meta itself — not by this app.

1. Open Instagram on your phone → **profile → ☰ menu → Settings and activity**.
2. **Account type and tools → Switch to professional account**.
3. Pick a category (e.g. *Gamer*), choose **Creator** or **Business**
   (both work; **Business** is the safer choice if you want the widest API
   compatibility).
4. Finish the wizard. If Instagram invites you to connect a Facebook Page, you
   can do it — but see Part 3: it is **optional** with the Instagram Login path.

### Check before moving on

In the app, open **Publishing**. The Instagram card shows a status line. It will
say the account is not connected yet — that's expected. The important thing is
that on Instagram itself, your profile now says *Professional account* under
Settings.

---

## Part 3 — Create a Meta app and get a token

Meta gives you two official doors. **Pick one.** If you don't have (and don't
want) a Facebook Page, pick **Instagram Login**.

### Option A — Instagram Login (no Facebook Page needed) ← recommended

1. Go to [developers.facebook.com](https://developers.facebook.com) and log in
   with the same account you use for Instagram → **My Apps → Create app**.
2. For "What do you want your app to do?" choose the **Instagram** use case, and
   if asked for an app type pick **Business**. Name it anything (e.g. `clipx-publisher`).
3. In the app dashboard, open the **Instagram → API setup with Instagram login**
   product.
4. Under **Permissions**, make sure these two are present:
   - `instagram_business_basic`
   - `instagram_business_content_publish`
5. In **Generate access tokens**, click **Add account** / **Generate token**,
   log in with the Instagram account from Part 2, and approve.
6. Copy two things from that panel:
   - the **Instagram account ID** (a 17-digit number like `17841400000000000`)
   - the **access token** (a long string starting with `IG...` or `EAAG...`)

> The token shown in the dashboard is short-lived. Under the token, click
> **Exchange for long-lived token** (or call
> `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=…&access_token=…`).
> Long-lived tokens last **~60 days**; re-run this when publishing starts failing
> with "token expired".

### Option B — Facebook Login (needs a Facebook Page)

1. On Instagram: **Settings → Account type and tools → share to Facebook** and
   connect a Facebook Page you manage to the professional account.
2. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app**
   → use case **Other** → type **Business**.
3. Add the **Instagram** product ("API setup with Facebook login").
4. Required permissions: `instagram_basic` and `instagram_content_publish`
   (plus `pages_show_list` and `pages_read_engagement` if the dashboard asks).
5. **Generate access token** → log in → select your Page → approve.
6. Find the Instagram account ID: open the Graph API Explorer and run
   `me/accounts` → take a Page `id` → run `{page-id}?fields=instagram_business_account`
   → the `id` inside is your Instagram user ID.
7. Exchange the short-lived token for a long-lived one:
   `GET https://graph.facebook.com/v23.0/oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-token}`

### Check before moving on

You should be holding **two strings**: an Instagram account ID and a token. Keep
them handy for Part 5. Don't paste them into chats or commit them anywhere.

---

## Part 4 — Create a free bucket for the video files

Why this is needed: Instagram's API **does not accept file uploads**. It fetches
the video from a URL, so your rendered Short has to live somewhere public-ish
first. Any S3-compatible storage works.

### Easiest: Cloudflare R2 (free tier, no credit card)

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) → **R2** →
   **Create bucket**, name it e.g. `clipx-clips`.
2. Note the **S3 endpoint** shown on the bucket/R2 overview page:
   `https://<account-id>.r2.cloudflarestorage.com`
3. **R2 → Manage R2 API Tokens → Create API token** → permission
   **Object Read & Write** → scope it to this bucket → **Create**.
4. Copy the **Access Key ID** and **Secret Access Key** (shown once).

### Also fine: AWS S3, Backblaze B2, MinIO, Wasabi

You need the same four values: endpoint, region, bucket, access key + secret.
For AWS the endpoint is `https://s3.<region>.amazonaws.com` and the region is
like `us-east-1`. For MinIO it's your own `http(s)://host:9000`.

### Public URL or presigned?

- **Leave `Public base URL` empty** → the app generates **presigned links valid
  for 24 h**. Easiest, works with private buckets, nothing else to configure.
- **Fill `Public base URL`** (CDN domain or a public bucket URL) → links never
  expire. Slightly more robust for slow render→publish gaps.

Don't make a bucket public unless you're comfortable with those files being
world-readable by URL.

---

## Part 5 — Connect everything inside the app

1. Open **http://localhost:3000/publishing** (sidebar → **Publishing**).
2. **Instagram account** card:
   - paste the **Instagram user ID** and the **token** from Part 3;
   - set **Login path** to match what you used: *Facebook Login* or
     *Instagram Login*;
   - edit **Hashtags** if you like (they get appended to auto-captions);
   - leave **Auto-publish** off for now.
3. **Media hosting** card: paste endpoint, region (`auto` for R2), bucket, access
   key, secret. Leave prefix `clipx` and the public URL empty unless you set one
   up.
4. Click **Save publishing settings**.
5. Click **Verify connection**. Expected: a green line naming your
   `@username`, your account type, and the remaining daily posts.
6. Click **Test bucket**. Expected: a green line saying the object was uploaded
   and read back.

If either check fails, the message names the cause (wrong ID, expired token,
personal account, bad endpoint, refused connection) — fix and retry. Nothing is
posted by these two checks.

### Publish something — the manual path

1. Go to **Monitoring**, open a stream (the demo sandbox works), and trigger a
   capture, **or** upload a video.
2. Wait for the clip and its vertical Short to appear under **Clips**.
3. Back on **Publishing**, the Short shows with an editable caption.
4. Click **Publish to Instagram**. The status moves through
   *hosting → creating → processing → published*, and a permalink appears.

Instagram takes 10–60 s to process a Reel. The page updates itself; no refresh
needed.

### Publish hands-free

1. On **Publishing**, tick **Auto-publish every generated Short** and save.
2. (Optional) In **Per-stream overrides**, set individual streams to
   *Always auto-publish* or *Never auto-publish*.
3. Trigger a capture. When the Short is rendered, it posts by itself.

That's the whole thing. From here, every Short you generate goes straight to
Reels.

---

## Everyday use

| Task | Where |
|---|---|
| See what was posted and when | Publishing → **Publishing history** |
| Fix a caption before posting | Publishing → clip card → edit caption → **Publish** |
| Re-post something | Publishing → clip card → **Republish Reel** |
| Pause auto-posting | Publishing → untick **Auto-publish** → save |
| Rotate the token (every ~60 days) | Part 3 again → paste the new token → save |

---

## Troubleshooting

| Message | Meaning | Fix |
|---|---|---|
| *Add your Instagram Business/Creator account ID and a long-lived access token first* | Fields empty | Part 3 + Part 5 |
| *This is a personal Instagram account* | Meta refuses personal accounts | Part 2 |
| *Token has expired / invalid OAuth access token* | Short-lived token, or 60 days passed | Exchange for a long-lived token, paste it in |
| *Missing permission / (#10) application does not have permission* | Scopes not granted on the app | Add `instagram_*_content_publish` in the Meta dashboard, regenerate the token |
| *Unsupported request / object does not exist* | Wrong Instagram ID, or ID belongs to another app's account | Copy the ID from the same panel that produced the token |
| *URL unreachable / media download failed* | Bucket not public and no presigned fallback, or wrong endpoint | Click **Test bucket**; check the endpoint starts with `https://` |
| *Storage upload failed … Connection refused / not resolved* | Endpoint typo, or the host blocks this machine | Fix the endpoint; corporate proxies can also break TLS — the message says which |
| *Rate limit / quota* | 50 posts in 24 h | Wait, or reduce auto-publishing |
| *Video does not meet Reels requirements* | Wrong codec/length/size | Use the app's own Shorts — it always renders compliant MP4s |
| Publishing spins forever at *processing* | Instagram couldn't fetch the video fast enough | Keep presigned links, or use a public bucket/CDN |

---

## What this app will not do (and why)

- **Post to a personal Instagram account.** Meta has no API for it. Tools that
  claim otherwise automate Instagram's private app API, which violates the Terms
  of Use and gets accounts banned. This app tells you what to change instead.
- **Upload the file directly to Instagram.** The API has no upload endpoint; URLs
  are the only supported route.
- **Guarantee a 100% success rate.** Meta's processing step can fail for reasons
  outside the app's control (network, codec edge cases, transient 500s). Every
  attempt is recorded with the platform's own error text so you can see why.

---

## Commands you'll actually use

```bash
npm run dev            # develop (recompiles pages on demand)
npm run build && npm start   # production
npm run smoke          # 21 HTTP checks against a running server
npm run test:s3        # S3 signing correctness (no network)
npm run test:social    # full Instagram flow against a mock API + mock bucket
```

`test:social` needs the server started with
`IG_GRAPH_BASE_URL=http://127.0.0.1:3900/graph` so it can talk to its own mock
instead of Meta. It never touches your real account.
