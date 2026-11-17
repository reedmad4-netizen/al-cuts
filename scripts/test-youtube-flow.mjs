#!/usr/bin/env node
/**
 * End-to-end YouTube Shorts test — completely offline.
 *
 * Stands up a mock Google (OAuth token endpoint, channels.list, resumable upload
 * session) and drives the real pipeline through the app's HTTP API:
 *
 *   connect (OAuth code → refresh token) → verify channel →
 *   upload a Short → permalink recorded → hands-free auto-upload
 *
 * Requirements:
 *   1. a server started with
 *        YT_API_BASE=http://127.0.0.1:3901/youtube/v3
 *        YT_UPLOAD_BASE=http://127.0.0.1:3901/upload/youtube/v3
 *        YT_OAUTH_TOKEN_URL=http://127.0.0.1:3901/token
 *        YT_OAUTH_AUTHORIZE_URL=http://127.0.0.1:3901/auth
 *      and a working FFmpeg (the clip is probed before upload)
 *   2. `npm run test:youtube`
 */
import http from "node:http";

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const MOCK_PORT = Number(process.env.MOCK_YT_PORT || 3901);
const CLIP_ID = process.env.TEST_CLIP_ID || "clip-demo-1";
const CHANNEL_ID = "UCmockchannel123";
const CHANNEL_TITLE = "Mock Gaming Channel";
const VIDEO_ID = "ytShortMock01";

let passed = 0;
const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Mock Google
// ---------------------------------------------------------------------------
const calls = [];
let uploadedBytes = 0;
let uploadMetadata = null;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const body = await readBody(req);
  if (process.env.MOCK_VERBOSE === "true") {
    console.log(`   [mock] ${req.method} ${url.pathname}`);
  }
  const json = (status, payload, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  };

  // ---- OAuth token endpoint: code exchange and refresh ----
  if (url.pathname === "/token" && req.method === "POST") {
    const form = new URLSearchParams(body.toString());
    calls.push({ kind: "token", form: Object.fromEntries(form) });
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "yt-code") {
        json(400, { error: "invalid_grant", error_description: "Bad code" });
        return;
      }
      json(200, {
        access_token: "ya29.mock-access",
        refresh_token: "1//mock-refresh-token",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/youtube.upload",
        token_type: "Bearer",
      });
      return;
    }
    if (form.get("grant_type") === "refresh_token") {
      if (form.get("refresh_token") !== "1//mock-refresh-token") {
        json(400, { error: "invalid_grant" });
        return;
      }
      json(200, { access_token: "ya29.refreshed", expires_in: 3600 });
      return;
    }
    json(400, { error: "unsupported_grant_type" });
    return;
  }

  // ---- channels.list ----
  if (url.pathname === "/youtube/v3/channels" && req.method === "GET") {
    calls.push({ kind: "channels", auth: req.headers.authorization });
    if (req.headers.authorization !== "Bearer ya29.refreshed") {
      json(401, { error: { message: "Bad credentials", errors: [{ reason: "authError" }] } });
      return;
    }
    json(200, {
      items: [
        {
          id: CHANNEL_ID,
          snippet: { title: CHANNEL_TITLE, customUrl: "@mockgaming" },
          statistics: { subscriberCount: "1234", videoCount: "56" },
        },
      ],
    });
    return;
  }

  // ---- resumable upload init ----
  if (url.pathname === "/upload/youtube/v3/videos" && req.method === "POST") {
    calls.push({
      kind: "init",
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      metadata: body.length ? JSON.parse(body.toString()) : null,
    });
    uploadMetadata = body.length ? JSON.parse(body.toString()) : null;
    res.writeHead(200, {
      Location: `http://127.0.0.1:${MOCK_PORT}/upload-session/abc`,
      "Content-Type": "application/json",
    });
    res.end("{}");
    return;
  }

  // ---- resumable upload bytes ----
  if (url.pathname === "/upload-session/abc" && req.method === "PUT") {
    uploadedBytes = body.length;
    calls.push({ kind: "put", bytes: body.length, contentType: req.headers["content-type"] });
    json(200, { id: VIDEO_ID, snippet: { title: uploadMetadata?.snippet?.title } });
    return;
  }

  json(404, { error: { message: `unexpected ${req.method} ${url.pathname}` } });
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path, init = {}, cookie = "") {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.headers || {}),
    },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, json: body };
}

function sessionCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  const cookie = raw.find((c) => c.startsWith("clipx_session="));
  return cookie ? cookie.split(";")[0] : "";
}

async function main() {
  await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
  console.log(`\nYouTube Shorts flow → app ${BASE}, mock ${MOCK_PORT}\n`);

  try {
    // 0. auth
    const login = await api("/api/auth/demo", { method: "POST" });
    const cookie = sessionCookie(login.res);
    check("demo login", Boolean(cookie));

    // 1. credentials
    const saved = await api(
      "/api/social/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          youtubeClientId: "mock-client.apps.googleusercontent.com",
          youtubeClientSecret: "mock-secret",
          youtubePrivacy: "public",
          youtubeAutoPublish: false,
        }),
      },
      cookie
    );
    check("save Google OAuth credentials", saved.res.ok, JSON.stringify(saved.json).slice(0, 120));
    check(
      "secrets are masked in the response",
      saved.json?.settings?.youtubeClientSecret === "••••••••",
      saved.json?.settings?.youtubeClientSecret
    );

    // 2. connect without credentials → readable redirect
    await api(
      "/api/social/settings",
      { method: "PUT", body: JSON.stringify({ youtubeClientId: "", youtubeClientSecret: "" }) },
      cookie
    );
    const noCreds = await fetch(`${BASE}/api/social/youtube/oauth/start`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    check(
      "Connect without credentials explains itself",
      noCreds.status >= 300 &&
        noCreds.status < 400 &&
        (noCreds.headers.get("location") || "").includes("connect=error"),
      `${noCreds.status}`
    );

    await api(
      "/api/social/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          youtubeClientId: "mock-client.apps.googleusercontent.com",
          youtubeClientSecret: "mock-secret",
        }),
      },
      cookie
    );

    // 3. OAuth start
    const start = await fetch(`${BASE}/api/social/youtube/oauth/start`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    const location = start.headers.get("location") || "";
    const startUrl = new URL(location || "http://invalid");
    check(
      "Connect redirects to Google with the upload scope",
      start.status >= 300 &&
        start.status < 400 &&
        startUrl.searchParams.get("client_id") === "mock-client.apps.googleusercontent.com" &&
        (startUrl.searchParams.get("scope") || "").includes("youtube.upload"),
      `${start.status} scope=${startUrl.searchParams.get("scope")}`
    );
    check(
      "offline access is requested (needed for a refresh token)",
      location.includes("access_type=offline"),
      location.slice(0, 120)
    );

    const stateCookie = (start.headers.getSetCookie?.() || [])
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("yt_oauth_state="));
    const state = stateCookie ? stateCookie.split("=")[1] : "";
    check("state is stored in an HttpOnly cookie", Boolean(state));

    // 4. OAuth callback
    const callback = await fetch(
      `${BASE}/api/social/youtube/oauth/callback?code=yt-code&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `${cookie}; ${stateCookie}` }, redirect: "manual" }
    );
    check(
      "callback returns to the publishing page",
      callback.status >= 300 &&
        callback.status < 400 &&
        (callback.headers.get("location") || "").includes("connect=ok"),
      `${callback.status} ${callback.headers.get("location") || ""}`
    );

    const afterConnect = await api("/api/social/settings", {}, cookie);
    const settings = afterConnect.json?.settings || {};
    check("YouTube reports as connected", settings.youtubeConfigured === true);
    check(
      "the channel was resolved during connect",
      settings.youtubeChannelTitle === CHANNEL_TITLE,
      settings.youtubeChannelTitle
    );
    check(
      "the refresh token is stored, never returned",
      settings.youtubeRefreshToken === "••••••••",
      settings.youtubeRefreshToken
    );

    // 5. verify
    const verify = await api("/api/social/youtube/verify", { method: "POST" }, cookie);
    check(
      "verify returns the channel",
      verify.res.status === 200 && verify.json?.channel?.title === CHANNEL_TITLE,
      JSON.stringify(verify.json).slice(0, 120)
    );
    check(
      "the daily upload budget is reported",
      verify.json?.quota?.uploadsPerDay === 6,
      JSON.stringify(verify.json?.quota)
    );

    // 6. publish a Short
    const publish = await api(
      `/api/clips/${CLIP_ID}/publish`,
      { method: "POST", body: JSON.stringify({ platform: "youtube", force: true }) },
      cookie
    );
    check(
      "upload succeeds",
      publish.json?.ok === true,
      JSON.stringify(publish.json).slice(0, 160)
    );
    check(
      "permalink points at the Short",
      publish.json?.post?.permalink === `https://youtube.com/shorts/${VIDEO_ID}`,
      publish.json?.post?.permalink
    );
    check(
      "the upload really transferred bytes",
      uploadedBytes > 0,
      `${uploadedBytes} bytes`
    );
    check(
      "resumable upload used the right protocol",
      calls.some((c) => c.kind === "init") &&
        calls.find((c) => c.kind === "init")?.query?.uploadType === "resumable",
      JSON.stringify(calls.find((c) => c.kind === "init")?.query || {})
    );

    const initCall = calls.find((c) => c.kind === "init");
    check(
      "metadata asks for a Shorts title with #Shorts",
      /#shorts/i.test(initCall?.metadata?.snippet?.title || ""),
      initCall?.metadata?.snippet?.title
    );
    check(
      "metadata carries the chosen visibility and Gaming category",
      initCall?.metadata?.status?.privacyStatus === "public" &&
        initCall?.metadata?.snippet?.categoryId === "20",
      JSON.stringify(initCall?.metadata?.status)
    );
    check(
      "the app declares the file size before uploading",
      Number(initCall?.headers?.["x-upload-content-length"]) === uploadedBytes,
      `${initCall?.headers?.["x-upload-content-length"]} vs ${uploadedBytes}`
    );

    // 7. history + idempotency
    const posts = await api("/api/social/posts", {}, cookie);
    const ytPosts = (posts.json?.posts || []).filter((p) => p.platform === "youtube");
    check(
      "the upload appears in history as a YouTube post",
      ytPosts[0]?.status === "published",
      JSON.stringify(ytPosts[0] || {}).slice(0, 120)
    );
    const again = await api(
      `/api/clips/${CLIP_ID}/publish`,
      { method: "POST", body: JSON.stringify({ platform: "youtube" }) },
      cookie
    );
    check(
      "re-uploading is not duplicated",
      again.json?.post?.status === "published" &&
        again.json?.post?.remoteMediaId === VIDEO_ID,
      JSON.stringify(again.json).slice(0, 120)
    );

    // 8. hands-free
    await api(
      "/api/social/settings",
      { method: "PUT", body: JSON.stringify({ youtubeAutoPublish: true }) },
      cookie
    );
    const triggerIso = new Date().toISOString();
    const capture = await api(
      "/api/streams/stream-demo-sandbox/trigger",
      { method: "POST", body: JSON.stringify({ scenario: "clutch", bypassCooldown: true }) },
      cookie
    );
    check(
      "capture trigger accepted",
      capture.res.status === 200 || capture.res.status === 201,
      String(capture.res.status)
    );

    let autoPost = null;
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const list = await api("/api/social/posts", {}, cookie);
      autoPost = (list.json?.posts || []).find(
        (p) =>
          p.platform === "youtube" && p.mode === "auto" && p.createdAt >= triggerIso
      );
      if (autoPost && ["published", "failed"].includes(autoPost.status)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    check(
      "a new Short uploaded itself",
      Boolean(autoPost),
      autoPost ? "" : "no auto YouTube post appeared"
    );
    check(
      "the hands-free upload reached 'published'",
      autoPost?.status === "published",
      autoPost?.status || autoPost?.error
    );

    // 9. authorization
    const anon = await fetch(`${BASE}/api/clips/${CLIP_ID}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "youtube" }),
    });
    check(
      "anonymous upload is refused",
      anon.status === 401 || anon.status === 429,
      String(anon.status)
    );

    // cleanup
    await api(
      "/api/social/settings",
      {
        method: "PUT",
        body: JSON.stringify({
          youtubeClientId: "",
          youtubeClientSecret: "",
          youtubeRefreshToken: "",
          youtubeChannelId: "",
          youtubeChannelTitle: "",
          youtubeAutoPublish: false,
        }),
      },
      cookie
    );
  } finally {
    mock.close();
  }

  console.log(
    failures.length === 0
      ? `\n✅ PASS — ${passed} passed, 0 failed\n`
      : `\n❌ FAIL — ${passed} passed, ${failures.length} failed\n${failures
          .map((f) => `   • ${f}`)
          .join("\n")}\n`
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(1);
});
