import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings } from "@/lib/db";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { YOUTUBE_AUTHORIZE_URL, YOUTUBE_SCOPE } from "@/lib/youtube";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";
const REDIRECT_COOKIE = "yt_oauth_redirect";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "social:oauth", 10, 5 * 60_000);
  if (limited) return limited;

  const origin = resolveRequestOrigin(req);
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth?next=/publishing", origin));
  }

  const settings = getSocialSettings(user.id);
  if (!settings.youtubeClientId || !settings.rawYouTubeClientSecret) {
    const url = new URL("/publishing", origin);
    url.searchParams.set("connect", "error");
    url.searchParams.set(
      "message",
      "Add your Google OAuth client id and secret first (open Advanced on the YouTube card), press Save, then Connect YouTube again."
    );
    return NextResponse.redirect(url);
  }

  const redirectUri = `${origin}/api/social/youtube/oauth/callback`;
  const state = crypto.randomBytes(24).toString("base64url");

  const authorize = new URL(YOUTUBE_AUTHORIZE_URL);
  authorize.searchParams.set("client_id", settings.youtubeClientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", YOUTUBE_SCOPE);
  // offline + consent are what actually produce a refresh token.
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");
  authorize.searchParams.set("include_granted_scopes", "true");
  authorize.searchParams.set("state", state);

  const res = NextResponse.redirect(authorize.toString());
  const cookieBase = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  };
  res.cookies.set(STATE_COOKIE, state, cookieBase);
  res.cookies.set(REDIRECT_COOKIE, redirectUri, cookieBase);
  return res;
}
