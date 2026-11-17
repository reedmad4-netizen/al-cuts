#!/usr/bin/env node
/**
 * End-to-end Instagram publishing test — completely offline.
 *
 * Spins up a mock Graph API + mock S3 bucket, then drives the real pipeline
 * (validation → upload → container → processing → publish) through the HTTP API
 * of a running CLIPX AI server.
 *
 * Requirements:
 *   1. a server started with  IG_GRAPH_BASE_URL=http://127.0.0.1:3900/graph
 *      and a working FFmpeg (needed to probe/validate the clip)
 *   2. `npm run test:social`
 *
 * The mock asserts on the payload Instagram would receive, so it catches
 * request-shape regressions (media_type, video_url, caption, access token).
 */
import http from "node:http";

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3100").replace(/\/$/, "");
const MOCK_PORT = Number(process.env.MOCK_PORT || 3900);
const IG_USER_ID = "17841400000000001";
const PERSONAL_IG_USER_ID = "17841400000000099";
const TOKEN = "test-long-lived-token";
const CLIP_ID = process.env.TEST_CLIP_ID || "clip-demo-1";

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
// Mock Graph API + mock S3
// ---------------------------------------------------------------------------
const uploadedObjects = new Map();
const graphCalls = [];

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  if (process.env.MOCK_VERBOSE === "true") {
    console.log(`   [mock] ${req.method} ${url.pathname}${url.search ? "?…" : ""}`);
  }
  const body = await readBody(req);
  const json = (status, payload) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  // ---- mock S3 ----
  if (url.pathname.startsWith("/s3/")) {
    if (req.method === "PUT") {
      uploadedObjects.set(url.pathname, body);
      res.writeHead(200, { ETag: '"mock"' });
      res.end();
      return;
    }
    if (req.method === "GET") {
      const stored = uploadedObjects.get(url.pathname);
      if (!stored) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "video/mp4" });
      res.end(stored);
      return;
    }
  }

  // ---- mock Graph API ----
  const graphMatch = url.pathname.match(/^\/graph\/[^/]+\/(.+)$/);
  if (!graphMatch) {
    json(404, { error: { message: "unknown route" } });
    return;
  }
  const path = graphMatch[1];
  graphCalls.push({ method: req.method, path, query: url.searchParams, body });

  // personal account (unsupported by the publishing API)
  if (req.method === "GET" && path === PERSONAL_IG_USER_ID) {
    json(200, {
      id: PERSONAL_IG_USER_ID,
      username: "personal_demo",
      account_type: "PERSONAL",
    });
    return;
  }

  // account profile
  if (req.method === "GET" && path === IG_USER_ID) {
    json(200, {
      id: IG_USER_ID,
      username: "clipx_demo",
      name: "CLIPX Demo",
      account_type: "BUSINESS",
    });
    return;
  }

  // quota
  if (req.method === "GET" && path === `${IG_USER_ID}/content_publishing_limit`) {
    json(200, { data: [{ quota_usage: 3, config: { quota_total: 50 } }] });
    return;
  }

  // create container
  if (req.method === "POST" && path === `${IG_USER_ID}/media`) {
    const form = new URLSearchParams(body.toString());
    const mediaType = form.get("media_type");
    const videoUrl = form.get("video_url") || "";
    const caption = form.get("caption") || "";
    const accessToken = form.get("access_token") || url.searchParams.get("access_token");

    if (mediaType !== "REELS" || !videoUrl || !accessToken) {
      json(400, {
        error: { message: "mock: missing media_type/video_url/access_token", code: 100 },
      });
      return;
    }
    if (caption.length > 2200) {
      json(400, { error: { message: "mock: caption too long", code: 100 } });
      return;
    }
    // Instagram must be able to fetch the URL anonymously.
    const fetched = await fetch(videoUrl).catch(() => null);
    if (!fetched || !fetched.ok) {
      json(400, {
        error: {
          message: "Instagram was unable to download the video from the provided URL",
          code: 9004,
        },
      });
      return;
    }
    json(200, { id: "container-123" });
    return;
  }

  // container status
  if (req.method === "GET" && path === "container-123") {
    json(200, { status_code: "FINISHED", status: "Ready to publish" });
    return;
  }

  // publish
  if (req.method === "POST" && path === `${IG_USER_ID}/media_publish`) {
    const form = new URLSearchParams(body.toString());
    if (form.get("creation_id") !== "container-123") {
      json(400, { error: { message: "mock: bad creation_id", code: 100 } });
      return;
    }
    json(200, { id: "media-456" });
    return;
  }

  // permalink
  if (req.method === "GET" && path === "media-456") {
    json(200, { permalink: "https://www.instagram.com/reel/TEST123/" });
    return;
  }

  json(404, { error: { message: `mock: unhandled ${req.method} ${path}`, code: 100 } });
});

function startMock() {
  return new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));
}

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
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { res, json };
}

function sessionCookie(res) {
  const raw = res.headers.getSetCookie?.() || [];
  const cookie = raw.find((c) => c.startsWith("clipx_session="));
  return cookie ? cookie.split(";")[0] : "";
}

async function main() {
  await startMock();
  console.log(`\nInstagram publishing flow → app ${BASE}, mock ${MOCK_PORT}\n`);

  // 0. auth
  const demo = await api("/api/auth/demo", { method: "POST" });
  const cookie = sessionCookie(demo.res);
  check("demo login", demo.res.status === 200 && !!cookie);
  if (!cookie) throw new Error("cannot continue without a session");

  // 1. configure Instagram + storage
  const settingsRes = await api(
    "/api/social/settings",
    {
      method: "PUT",
      body: JSON.stringify({
        instagramUserId: IG_USER_ID,
        instagramAccessToken: TOKEN,
        instagramApiVersion: "v23.0",
        instagramShareToFeed: true,
        instagramHashtags: "#test #gaming",
        storageEndpoint: `http://127.0.0.1:${MOCK_PORT}/s3`,
        storageRegion: "auto",
        storageBucket: "clipx-test",
        storageAccessKeyId: "AKIDEXAMPLE",
        storageSecretAccessKey: "secret",
        storagePrefix: "test",
        storageForcePathStyle: true,
      }),
    },
    cookie
  );
  check("save Instagram + storage settings", settingsRes.res.status === 200, JSON.stringify(settingsRes.json).slice(0, 120));
  check(
    "secrets are masked in the response",
    settingsRes.json?.settings?.instagramAccessToken === "••••••••" &&
      settingsRes.json?.settings?.storageSecretAccessKey === "••••••••"
  );

  // 1b. login path (Facebook Login vs Instagram Login) round-trips
  const loginPathSaved = await api(
    "/api/social/settings",
    { method: "PUT", body: JSON.stringify({ instagramLoginMethod: "instagram" }) },
    cookie
  );
  check(
    "login path persists (Instagram Login)",
    loginPathSaved.json?.settings?.instagramLoginMethod === "instagram",
    JSON.stringify(loginPathSaved.json?.settings?.instagramLoginMethod)
  );
  await api(
    "/api/social/settings",
    { method: "PUT", body: JSON.stringify({ instagramLoginMethod: "facebook" }) },
    cookie
  );

  // 2. verify account
  const verify = await api("/api/social/instagram/verify", { method: "POST" }, cookie);
  check(
    "verify returns the connected account",
    verify.res.status === 200 && verify.json?.username === "clipx_demo",
    JSON.stringify(verify.json).slice(0, 160)
  );
  check("quota is reported", verify.json?.quota?.quota === 50, JSON.stringify(verify.json?.quota));

  // 3. storage round-trip
  const storage = await api("/api/social/storage/test", { method: "POST" }, cookie);
  check(
    "storage test uploads and reads back",
    storage.res.status === 200 && storage.json?.ok === true,
    JSON.stringify(storage.json).slice(0, 200)
  );

  // 4. publish the clip
  const publish = await api(
    `/api/clips/${CLIP_ID}/publish`,
    { method: "POST", body: JSON.stringify({ platform: "instagram", force: true }) },
    cookie
  );
  check(
    "publish succeeds",
    publish.res.status === 200 && publish.json?.ok === true,
    JSON.stringify(publish.json).slice(0, 240)
  );
  check(
    "permalink is stored",
    publish.json?.post?.permalink === "https://www.instagram.com/reel/TEST123/",
    publish.json?.post?.permalink
  );

  // 5. request shape sent to Instagram
  const containerCalls = graphCalls.filter(
    (call) => call.method === "POST" && call.path.endsWith("/media")
  );
  const containerCall = containerCalls[containerCalls.length - 1];
  const form = containerCall ? new URLSearchParams(containerCall.body.toString()) : null;
  check("REQUEST: media_type=REELS", form?.get("media_type") === "REELS");
  check(
    "REQUEST: public video URL is sent",
    Boolean(form?.get("video_url")?.startsWith(`http://127.0.0.1:${MOCK_PORT}/s3/`)),
    form?.get("video_url")
  );
  check(
    "REQUEST: caption auto-generated with hashtags",
    Boolean(form?.get("caption")?.includes("#test")) &&
      Boolean(form?.get("caption")?.includes("AI hype")),
    form?.get("caption")?.slice(0, 80)
  );

  // 6. history + idempotency
  const posts = await api("/api/social/posts", {}, cookie);
  check(
    "post appears as published in history",
    posts.json?.posts?.[0]?.status === "published",
    posts.json?.posts?.[0]?.status
  );

  const again = await api(
    `/api/clips/${CLIP_ID}/publish`,
    { method: "POST", body: JSON.stringify({ platform: "instagram" }) },
    cookie
  );
  check(
    "re-publish is not duplicated",
    again.json?.post?.status === "published" &&
      again.json?.post?.remoteMediaId === "media-456",
    JSON.stringify(again.json?.post?.status)
  );

  // 6b. hands-free auto-publish: enabling the toggle must publish the next
  //     generated Short without any user action.
  await api(
    "/api/social/settings",
    { method: "PUT", body: JSON.stringify({ instagramAutoPublish: true }) },
    cookie
  );

  const triggerIso = new Date().toISOString();
  // Only consider posts created after this moment: the database may contain
  // rows from earlier runs (or background captures) that must not be counted.
  const isNewPost = (post) => post.createdAt >= triggerIso;

  const capture = await api(
    "/api/streams/stream-demo-sandbox/trigger",
    {
      method: "POST",
      body: JSON.stringify({ scenario: "clutch", bypassCooldown: true }),
    },
    cookie
  );
  check(
    "capture trigger accepted",
    capture.res.status === 200 || capture.res.status === 201,
    String(capture.res.status)
  );

  let autoPost = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const list = await api("/api/social/posts", {}, cookie);
    const postsNow = list.json?.posts || [];
    autoPost = postsNow.find((p) => p.mode === "auto" && isNewPost(p));
    if (autoPost && ["published", "failed"].includes(autoPost.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  check(
    "auto-publish created a post without user action",
    Boolean(autoPost),
    autoPost ? "" : "no new auto post was created"
  );
  check(
    "auto-published Reel reached 'published'",
    autoPost?.status === "published",
    autoPost?.status || autoPost?.error
  );

  // 6c. personal accounts must be refused with guidance, not a generic error.
  await api(
    "/api/social/settings",
    {
      method: "PUT",
      body: JSON.stringify({
        instagramUserId: PERSONAL_IG_USER_ID,
        instagramAutoPublish: false,
      }),
    },
    cookie
  );
  const personal = await api("/api/social/instagram/verify", { method: "POST" }, cookie);
  check(
    "personal account is detected",
    personal.res.status === 400 && personal.json?.personalAccount === true,
    JSON.stringify(personal.json).slice(0, 160)
  );
  check(
    "personal account gets actionable guidance",
    /Business|Creator|professional/i.test(personal.json?.error || ""),
    personal.json?.error?.slice(0, 120)
  );

  const personalPublish = await api(
    `/api/clips/${CLIP_ID}/publish`,
    { method: "POST", body: JSON.stringify({ platform: "instagram", force: true }) },
    cookie
  );
  check(
    "publishing is blocked for a personal account",
    personalPublish.res.status === 400 &&
      /professional|Business|Creator/i.test(personalPublish.json?.error || ""),
    JSON.stringify(personalPublish.json).slice(0, 160)
  );

  // restore the professional account for the remaining checks
  await api(
    "/api/social/settings",
    {
      method: "PUT",
      body: JSON.stringify({ instagramUserId: IG_USER_ID }),
    },
    cookie
  );

  // 7. authorization: anonymous cannot publish
  const anon = await api(`/api/clips/${CLIP_ID}/publish`, {
    method: "POST",
    body: JSON.stringify({ platform: "instagram" }),
  });
  check("anonymous publish → 401", anon.res.status === 401, String(anon.res.status));

  // cleanup: leave the demo account unconfigured
  await api(
    "/api/social/settings",
    {
      method: "PUT",
      body: JSON.stringify({
        instagramUserId: "",
        instagramAccessToken: "",
        storageEndpoint: "",
        storageBucket: "",
        storageAccessKeyId: "",
        storageSecretAccessKey: "",
        instagramAutoPublish: false,
      }),
    },
    cookie
  );

  console.log(
    `\n${failures.length === 0 ? "✅ PASS" : "❌ FAIL"} — ${passed} passed, ${failures.length} failed\n`
  );
  for (const failure of failures) console.log(`   • ${failure}`);
  mock.close();
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFlow test crashed: ${err?.message || err}`);
  console.error(`Is the app running with IG_GRAPH_BASE_URL=http://127.0.0.1:${MOCK_PORT}/graph ?`);
  mock.close();
  process.exit(1);
});
