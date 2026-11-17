/**
 * Instagram Graph API — Reels content publishing.
 *
 * Constraints that shape this module:
 * - Only **Business / Creator** (professional) accounts can publish. A personal
 *   account cannot be posted to via Meta's API at all; there is no supported
 *   endpoint and the unofficial private APIs violate Instagram's Terms of Use.
 * - The API never accepts file bytes: Instagram downloads the video from a
 *   **public URL** we provide.
 * - Publishing is two-step: create a media *container*, wait for it to finish
 *   processing, then publish it.
 * - At most 50 API-published posts per rolling 24h per account.
 */

import { describeNetworkError } from "./net-errors";

export interface InstagramConfig {
  igUserId: string;
  accessToken: string;
  apiVersion: string;
  /** Overridable for tests/local mocks. */
  graphBaseUrl: string;
}

export const DEFAULT_GRAPH_VERSION = "v23.0";
export const DEFAULT_GRAPH_BASE = "https://graph.facebook.com";

export function resolveInstagramConfig(params: {
  igUserId?: string | null;
  accessToken?: string | null;
  apiVersion?: string | null;
  graphBaseUrl?: string | null;
}): InstagramConfig {
  return {
    igUserId: (params.igUserId || "").trim(),
    accessToken: (params.accessToken || "").trim(),
    apiVersion:
      (params.apiVersion || "").trim() ||
      process.env.IG_GRAPH_API_VERSION?.trim() ||
      DEFAULT_GRAPH_VERSION,
    graphBaseUrl:
      (params.graphBaseUrl || "").trim() ||
      process.env.IG_GRAPH_BASE_URL?.trim() ||
      DEFAULT_GRAPH_BASE,
  };
}

export function isInstagramConfigured(config: InstagramConfig): boolean {
  return Boolean(config.igUserId && config.accessToken);
}

export class InstagramError extends Error {
  code?: number;
  subcode?: number;
  status?: number;
  hint?: string;

  constructor(
    message: string,
    options: { code?: number; subcode?: number; status?: number; hint?: string } = {}
  ) {
    super(message);
    this.name = "InstagramError";
    this.code = options.code;
    this.subcode = options.subcode;
    this.status = options.status;
    this.hint = options.hint;
  }
}

interface GraphErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

/** Turns Meta's error codes into something actionable. */
function explainGraphError(
  message: string,
  code?: number,
  subcode?: number
): string {
  const lower = message.toLowerCase();

  if (code === 190 || lower.includes("access token")) {
    return (
      "Instagram rejected the access token. Generate a fresh long-lived token " +
      "for a user with instagram_content_publish, then save it in Settings."
    );
  }
  if (code === 4 || code === 613 || lower.includes("request limit")) {
    return (
      "Instagram's publishing rate limit was reached (50 posts per 24 hours). " +
      "Try again later or reduce auto-publish."
    );
  }
  if (
    lower.includes("professional") ||
    lower.includes("business account") ||
    lower.includes("not a business") ||
    subcode === 33
  ) {
    return (
      "This account cannot publish via the API. Instagram only allows Business " +
      "or Creator accounts linked to a Facebook Page. Switch the account to " +
      "professional in the Instagram app (Settings → Account type), then re-verify."
    );
  }
  if (
    lower.includes("video") &&
    (lower.includes("format") || lower.includes("aspect") || lower.includes("duration"))
  ) {
    return (
      "The video does not meet Reels requirements (MP4/H.264 + AAC, 9:16 aspect, " +
      "3–900 seconds, ≤1 GB). CLIPX AI validates these before uploading — if you " +
      "edited the file manually, re-export it."
    );
  }
  if (lower.includes("permission") || code === 10 || code === 200) {
    return (
      "The token is missing the instagram_content_publish (and instagram_basic) " +
      "permission. Add the scope in the Meta app dashboard and regenerate the token."
    );
  }
  if (lower.includes("url") || (code === 9004 && lower.includes("download"))) {
    return (
      "Instagram could not download the video from the public URL. Check that the " +
      "storage link is reachable from the internet and has not expired, then retry."
    );
  }
  return message;
}

async function graphRequest(
  config: InstagramConfig,
  path: string,
  init: { method?: string; query?: Record<string, string>; body?: Record<string, string> } = {}
): Promise<Record<string, unknown>> {
  const url = new URL(
    `${config.graphBaseUrl.replace(/\/+$/, "")}/${config.apiVersion}/${path.replace(
      /^\/+/,
      ""
    )}`
  );

  if (init.method === "POST" || init.body) {
    url.searchParams.set("access_token", config.accessToken);
    for (const [key, value] of Object.entries(init.query || {})) {
      url.searchParams.set(key, value);
    }

    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(init.body || {})) {
      form.set(key, value);
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new InstagramError(
        describeNetworkError(err, { action: "Instagram API request", url: url.toString() })
      );
    }
    return handleGraphResponse(res);
  }

  url.searchParams.set("access_token", config.accessToken);
  for (const [key, value] of Object.entries(init.query || {})) {
    url.searchParams.set(key, value);
  }

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new InstagramError(
      describeNetworkError(err, { action: "Instagram API request", url: url.toString() })
    );
  }
  return handleGraphResponse(res);
}

async function handleGraphResponse(
  res: Response
): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok || (json as GraphErrorPayload).error) {
    const err = (json as GraphErrorPayload).error;
    const message = err?.error_user_msg || err?.message || res.statusText || "Graph API error";
    throw new InstagramError(explainGraphError(message, err?.code, err?.error_subcode), {
      code: err?.code,
      subcode: err?.error_subcode,
      status: res.status,
      hint: err?.type,
    });
  }

  return json;
}

export interface InstagramAccountInfo {
  ok: boolean;
  username?: string;
  accountType?: string;
  name?: string;
  igUserId?: string;
  error?: string;
  /** True when the account exists but is not a professional account. */
  personalAccount?: boolean;
}

/**
 * Confirms the token works and the target id is an Instagram professional
 * account we can publish to.
 */
export async function verifyInstagramAccount(
  config: InstagramConfig
): Promise<InstagramAccountInfo> {
  if (!config.igUserId || !config.accessToken) {
    return {
      ok: false,
      error:
        "Add your Instagram Business/Creator account ID and a long-lived access token first.",
    };
  }

  try {
    const profile = await graphRequest(config, config.igUserId, {
      query: { fields: "id,username,name,account_type" },
    });
    const accountType = String(profile.account_type || profile.accountType || "");
    const username = profile.username ? String(profile.username) : undefined;

    const isProfessional =
      !accountType ||
      /business|creator|professional/i.test(accountType);

    return {
      ok: isProfessional,
      username,
      accountType: accountType || "unknown",
      name: profile.name ? String(profile.name) : undefined,
      igUserId: String(profile.id || config.igUserId),
      personalAccount: !isProfessional,
      error: isProfessional
        ? undefined
        : "This is a personal Instagram account. Meta's publishing API only supports Business or Creator accounts — switch the account type in the Instagram app, then re-verify.",
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not verify the Instagram account.",
    };
  }
}

export interface PublishQuota {
  used: number;
  quota: number;
  remaining: number;
}

/** Reads the account's rolling 24h publishing quota (50 by default). */
export async function getPublishQuota(
  config: InstagramConfig
): Promise<PublishQuota | null> {
  try {
    const json = await graphRequest(config, `${config.igUserId}/content_publishing_limit`, {
      query: { fields: "config,quota_usage" },
    });
    const data = Array.isArray(json.data)
      ? (json.data[0] as Record<string, unknown> | undefined)
      : undefined;
    const usage = Number(data?.quota_usage ?? 0);
    const configEntry = data?.config as
      | { quota_total?: number; quota_duration?: number }
      | undefined;
    const quota = Number(configEntry?.quota_total ?? 50);
    return { used: usage, quota, remaining: Math.max(0, quota - usage) };
  } catch {
    // Quota endpoint needs extra permissions on some setups — treat as unknown.
    return null;
  }
}

export interface PublishReelParams {
  videoUrl: string;
  caption: string;
  shareToFeed?: boolean;
  /** Max time to wait for Instagram to finish processing the upload. */
  processingTimeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (status: string) => void;
}

export interface PublishReelResult {
  mediaId: string;
  permalink: string | null;
  containerId: string;
}

/** Creates the Reels container, waits for processing, then publishes it. */
export async function publishReel(
  config: InstagramConfig,
  params: PublishReelParams
): Promise<PublishReelResult> {
  const pollInterval = params.pollIntervalMs ?? 4_000;
  const timeout = params.processingTimeoutMs ?? 10 * 60_000;

  const container = await graphRequest(config, `${config.igUserId}/media`, {
    method: "POST",
    body: {
      media_type: "REELS",
      video_url: params.videoUrl,
      caption: params.caption.slice(0, 2200),
      share_to_feed: params.shareToFeed === false ? "false" : "true",
    },
  });

  const containerId = String(container.id || "");
  if (!containerId) {
    throw new InstagramError(
      "Instagram accepted the request but returned no container id. Retry, or check the app's permissions."
    );
  }

  const deadline = Date.now() + timeout;
  let lastStatus = "IN_PROGRESS";

  while (Date.now() < deadline) {
    const status = await graphRequest(config, containerId, {
      query: { fields: "status_code,status" },
    });
    lastStatus = String(status.status_code || "IN_PROGRESS");
    params.onStatus?.(lastStatus);

    if (lastStatus === "FINISHED" || lastStatus === "PUBLISHED") break;

    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      throw new InstagramError(
        `Instagram could not process the Reel (status ${lastStatus}). ${
          status.status ? String(status.status) : ""
        }`.trim(),
        { hint: "processing" }
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  if (lastStatus !== "FINISHED" && lastStatus !== "PUBLISHED") {
    throw new InstagramError(
      `Timed out after ${Math.round(timeout / 60_000)} min waiting for Instagram to process the Reel. ` +
        "The upload may still complete — check the account before retrying.",
      { hint: "timeout" }
    );
  }

  const published = await graphRequest(config, `${config.igUserId}/media_publish`, {
    method: "POST",
    body: { creation_id: containerId },
  });

  const mediaId = String(published.id || "");
  let permalink: string | null = null;

  if (mediaId) {
    try {
      const info = await graphRequest(config, mediaId, {
        query: { fields: "permalink" },
      });
      permalink = info.permalink ? String(info.permalink) : null;
    } catch {
      // Permalink is a nicety; publishing already succeeded.
    }
  }

  return { mediaId, permalink, containerId };
}
