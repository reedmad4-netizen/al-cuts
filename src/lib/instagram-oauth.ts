/**
 * One-click "Connect Instagram" via Meta's Instagram Login OAuth.
 *
 * Manual setup asks a user to create a token in the Meta dashboard, copy an
 * account id, and exchange a short-lived token for a long-lived one — three
 * steps where people get lost. This module does the OAuth dance instead:
 *
 *   authorize → code → short-lived token (+ the account id, which Meta returns
 *   for free) → long-lived token (60 days) → stored for the user.
 *
 * Every host is overridable so the flow can be exercised against a mock.
 */
import { describeNetworkError } from "./net-errors";

const AUTHORIZE_URL =
  process.env.IG_OAUTH_AUTHORIZE_URL?.trim() ||
  "https://www.instagram.com/oauth/authorize";
const TOKEN_URL =
  process.env.IG_OAUTH_TOKEN_URL?.trim() ||
  "https://api.instagram.com/oauth/access_token";
const LONG_LIVED_URL =
  process.env.IG_LONG_LIVED_URL?.trim() ||
  "https://graph.instagram.com/access_token";
const REFRESH_URL =
  process.env.IG_REFRESH_URL?.trim() ||
  "https://graph.instagram.com/refresh_access_token";

/** Cookie holding the OAuth state value between /start and /callback. */
export const OAUTH_STATE_COOKIE = "ig_oauth_state";
/** The redirect_uri used at /start, reused verbatim at /callback. */
export const OAUTH_REDIRECT_COOKIE = "ig_oauth_redirect";

export const INSTAGRAM_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
];

export interface MetaAppCredentials {
  appId: string;
  appSecret: string;
}

export interface OAuthResult {
  igUserId: string;
  accessToken: string;
  /** ISO timestamp. Empty when Meta did not return an expiry. */
  expiresAt: string;
  accountType?: string;
  username?: string;
}

export class OAuthError extends Error {
  constructor(message: string, readonly step: string) {
    super(message);
    this.name = "OAuthError";
  }
}

export function isOAuthConfigured(creds: MetaAppCredentials): boolean {
  return Boolean(creds.appId && creds.appSecret);
}

export function buildAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_LOGIN_SCOPES.join(","));
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function postForm(url: string, form: Record<string, string>) {
  const body = new URLSearchParams(form).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new OAuthError(
      describeNetworkError(err, { action: "Instagram sign-in request", url }),
      "network"
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new OAuthError(
      `Instagram sign-in returned an unreadable response (HTTP ${res.status}).`,
      "parse"
    );
  }

  if (!res.ok || json.error_type || json.error) {
    const detail =
      (json.error_message as string) ||
      (json.error_description as string) ||
      (typeof json.error === "object" && json.error
        ? String((json.error as { message?: string }).message || "")
        : String(json.error || "")) ||
      `HTTP ${res.status}`;
    throw new OAuthError(`Instagram sign-in failed: ${detail}`, "exchange");
  }

  return json;
}

async function getJson(url: string, action: string) {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new OAuthError(
      describeNetworkError(err, { action, url: url.split("?")[0] }),
      "network"
    );
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new OAuthError(`${action} returned an unreadable response.`, "parse");
  }

  if (!res.ok || json.error_type || json.error) {
    const detail =
      (json.error_message as string) ||
      String(json.error || "") ||
      `HTTP ${res.status}`;
    throw new OAuthError(`${action} failed: ${detail}`, "exchange");
  }

  return json;
}

/**
 * Exchanges the OAuth `code` for a long-lived token and the Instagram account id.
 * The account id comes straight from Meta, so the user never has to find it.
 */
export async function exchangeCodeForToken(params: {
  code: string;
  redirectUri: string;
  creds: MetaAppCredentials;
}): Promise<OAuthResult> {
  const short = await postForm(TOKEN_URL, {
    client_id: params.creds.appId,
    client_secret: params.creds.appSecret,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code: params.code,
  });

  const shortToken = String(short.access_token ?? "");
  const userId = String(short.user_id ?? short.id ?? "");
  if (!shortToken || !userId) {
    throw new OAuthError(
      "Instagram did not return an access token. Check that the app has the Instagram product enabled and the redirect URI matches exactly.",
      "exchange"
    );
  }

  // Upgrade to a 60-day token. If this leg fails the short-lived token still
  // works for an hour, so keep it and report the shortened lifetime.
  try {
    const longLived = await getJson(
      `${LONG_LIVED_URL}?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(
        params.creds.appSecret
      )}&access_token=${encodeURIComponent(shortToken)}`,
      "Long-lived token exchange"
    );
    const token = String(longLived.access_token ?? shortToken);
    const expiresIn = Number(longLived.expires_in ?? 0);
    return {
      igUserId: userId,
      accessToken: token,
      expiresAt:
        expiresIn > 0
          ? new Date(Date.now() + expiresIn * 1000).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  } catch {
    return {
      igUserId: userId,
      accessToken: shortToken,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }
}

/** Refreshes a long-lived Instagram token (valid 24h after issue, ~60 days). */
export async function refreshLongLivedToken(
  accessToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const json = await getJson(
    `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(
      accessToken
    )}`,
    "Token refresh"
  );

  const token = String(json.access_token ?? "");
  const expiresIn = Number(json.expires_in ?? 0);
  if (!token) {
    throw new OAuthError("Instagram did not return a refreshed token.", "refresh");
  }
  return {
    accessToken: token,
    expiresAt:
      expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : "",
  };
}

export function isTokenExpiringSoon(expiresAt: string, withinDays = 7): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return ms - Date.now() < withinDays * 24 * 60 * 60 * 1000;
}
