/**
 * YouTube Shorts uploads — Data API v3, resumable upload.
 *
 * Unlike Instagram, YouTube accepts the file bytes directly, so no public media
 * hosting is involved: the app streams the rendered Short straight to Google.
 *
 * Constraints that shape this module:
 * - Auth is OAuth 2.0. The `refresh_token` is long-lived; access tokens last an
 *   hour and are refreshed transparently here.
 * - Uploads cost **1600 quota units** and the default project quota is 10,000
 *   units/day, i.e. ~6 uploads a day. That is a platform limit, not an app one,
 *   and the error message says so instead of looking like a bug.
 * - A vertical video under 3 minutes is published as a Short automatically; the
 *   `#Shorts` tag in the title/description makes the intent explicit.
 */
import fs from "node:fs";
import { describeNetworkError } from "./net-errors";

const API_BASE =
  process.env.YT_API_BASE?.trim() || "https://www.googleapis.com/youtube/v3";
const UPLOAD_BASE =
  process.env.YT_UPLOAD_BASE?.trim() ||
  "https://www.googleapis.com/upload/youtube/v3";
const OAUTH_TOKEN_URL =
  process.env.YT_OAUTH_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token";
export const YOUTUBE_AUTHORIZE_URL =
  process.env.YT_OAUTH_AUTHORIZE_URL?.trim() ||
  "https://accounts.google.com/o/oauth2/v2/auth";
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
/** 1600 units per upload against a default 10,000/day quota. */
export const UPLOADS_PER_DAY = 6;

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  handle?: string;
  subscribers?: string;
  videos?: string;
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly hint?: string
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

export function isYouTubeConfigured(config: YouTubeConfig): boolean {
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

// Access tokens are per refresh-token; cache until shortly before expiry.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(config: YouTubeConfig): Promise<string> {
  const cacheKey = `${config.clientId}:${config.refreshToken.slice(-12)}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;

  const form = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  let res: Response;
  try {
    res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new YouTubeError(
      describeNetworkError(err, {
        action: "Google token request",
        url: OAUTH_TOKEN_URL,
      })
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new YouTubeError("Google returned an unreadable token response.");
  }

  if (!res.ok || !json.access_token) {
    const code = String(json.error ?? "");
    if (code === "invalid_grant") {
      throw new YouTubeError(
        "Google rejected the saved authorization (invalid_grant). Reconnect YouTube — this happens when access is revoked, or when a test-mode app's refresh token expires after 7 days.",
        code,
        "Reconnect YouTube from the Publishing page."
      );
    }
    throw new YouTubeError(
      `Google token request failed: ${
        String(json.error_description ?? json.error ?? `HTTP ${res.status}`)
      }`,
      code
    );
  }

  const token = String(json.access_token);
  const expiresIn = Number(json.expires_in ?? 3600);
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return token;
}

async function googleJson(
  url: string,
  init: RequestInit,
  action: string
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new YouTubeError(
      describeNetworkError(err, { action, url })
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new YouTubeError(`${action} returned an unreadable response.`);
  }

  if (!res.ok || json.error) {
    const error = json.error as
      | { message?: string; errors?: { reason?: string; message?: string }[] }
      | undefined;
    const reason = error?.errors?.[0]?.reason || "";
    const message = error?.message || error?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new YouTubeError(`${action} failed: ${message}`, reason, explainReason(reason));
  }

  return json;
}

function explainReason(reason: string): string | undefined {
  if (reason === "quotaExceeded" || reason === "uploadLimitExceeded") {
    return "YouTube's daily API quota is used up. A free project gets 10,000 units/day and one upload costs 1,600 — about 6 uploads. Wait for the quota to reset (midnight Pacific), or request a quota increase in Google Cloud.";
  }
  if (reason === "forbidden" || reason === "insufficientPermissions") {
    return "The Google account did not grant the YouTube upload scope. Reconnect and accept all permissions.";
  }
  if (reason === "youtubeSignupRequired") {
    return "This Google account has no YouTube channel yet. Create one at youtube.com, then reconnect.";
  }
  if (reason === "invalid_grant" || reason === "unauthorized") {
    return "The saved authorization is no longer valid. Reconnect YouTube.";
  }
  return undefined;
}

export async function verifyYouTubeChannel(
  config: YouTubeConfig
): Promise<{ ok: boolean; channel?: YouTubeChannel; error?: string; hint?: string }> {
  try {
    const token = await getAccessToken(config);
    const json = await googleJson(
      `${API_BASE}/channels?part=snippet,statistics&mine=true`,
      { headers: { Authorization: `Bearer ${token}` } },
      "YouTube channel lookup"
    );

    const items = (json.items as Record<string, unknown>[] | undefined) || [];
    if (items.length === 0) {
      return {
        ok: false,
        error: "This Google account has no YouTube channel.",
        hint: "Create a channel at youtube.com, then reconnect.",
      };
    }

    const item = items[0];
    const snippet = (item.snippet as Record<string, unknown>) || {};
    const stats = (item.statistics as Record<string, unknown>) || {};
    return {
      ok: true,
      channel: {
        id: String(item.id),
        title: String(snippet.title ?? "YouTube channel"),
        handle: snippet.customUrl ? String(snippet.customUrl) : undefined,
        subscribers: stats.subscriberCount ? String(stats.subscriberCount) : undefined,
        videos: stats.videoCount ? String(stats.videoCount) : undefined,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not reach YouTube.",
      hint: err instanceof YouTubeError ? err.hint : undefined,
    };
  }
}

export interface UploadResult {
  videoId: string;
  permalink: string;
  title: string;
}

/**
 * Uploads one video as a Short.
 *
 * Resumable protocol: init returns a session URI, then the bytes go to that URI
 * in a single PUT. Shorts are small (≤ 60 s), so buffering the file is fine and
 * keeps the request simple; anything above the cap is refused up front.
 */
export async function uploadShort(
  config: YouTubeConfig,
  params: {
    filePath: string;
    title: string;
    description: string;
    privacyStatus: "public" | "unlisted" | "private";
    categoryId?: string;
    madeForKids?: boolean;
  }
): Promise<UploadResult> {
  const stat = fs.statSync(params.filePath);
  const MAX_BYTES = 128 * 1024 * 1024;
  if (stat.size > MAX_BYTES) {
    throw new YouTubeError(
      `Video is ${(stat.size / 1024 / 1024).toFixed(1)} MB; this uploader handles up to 128 MB (a Short is normally well under that).`
    );
  }

  const token = await getAccessToken(config);
  const body = fs.readFileSync(params.filePath);

  const metadata = {
    snippet: {
      title: params.title.slice(0, 100),
      description: params.description.slice(0, 4900),
      categoryId: params.categoryId || "20", // Gaming
    },
    status: {
      privacyStatus: params.privacyStatus,
      selfDeclaredMadeForKids: Boolean(params.madeForKids),
    },
  };

  let init: Response;
  try {
    init = await fetch(
      `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(stat.size),
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(60_000),
      }
    );
  } catch (err) {
    throw new YouTubeError(
      describeNetworkError(err, { action: "YouTube upload start", url: UPLOAD_BASE })
    );
  }

  if (!init.ok) {
    const text = await init.text();
    let reason = "";
    let message = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; errors?: { reason?: string }[] };
      };
      reason = parsed.error?.errors?.[0]?.reason || "";
      message = parsed.error?.message || message;
    } catch {
      /* plain text body */
    }
    throw new YouTubeError(
      `YouTube refused the upload: ${message}`,
      reason,
      explainReason(reason)
    );
  }

  const sessionUrl = init.headers.get("location");
  if (!sessionUrl) {
    throw new YouTubeError("YouTube did not return an upload session URL.");
  }

  let put: Response;
  try {
    put = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch (err) {
    throw new YouTubeError(
      describeNetworkError(err, { action: "YouTube video upload", url: sessionUrl })
    );
  }

  const putText = await put.text();
  let putJson: Record<string, unknown> = {};
  try {
    putJson = putText ? JSON.parse(putText) : {};
  } catch {
    /* handled below */
  }

  if (!put.ok || !putJson.id) {
    const error = putJson.error as
      | { message?: string; errors?: { reason?: string }[] }
      | undefined;
    const reason = error?.errors?.[0]?.reason || "";
    throw new YouTubeError(
      `YouTube rejected the video: ${error?.message || `HTTP ${put.status}`}`,
      reason,
      explainReason(reason)
    );
  }

  const videoId = String(putJson.id);
  return {
    videoId,
    permalink: `https://youtube.com/shorts/${videoId}`,
    title: params.title,
  };
}

/** Shorts title: keep it under 100 chars and make the format explicit. */
export function buildYouTubeTitle(clip: {
  title: string;
  aiScore?: number;
}): string {
  const base = (clip.title || "Gaming highlight").replace(/\s+/g, " ").trim();
  const score = clip.aiScore ? ` (${Math.round(clip.aiScore)}/100 AI hype)` : "";
  const withTag = /#shorts/i.test(base) ? base : `${base} #Shorts`;
  return `${withTag}${score}`.slice(0, 100);
}
