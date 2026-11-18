import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings } from "@/lib/db";
import {
  buildAuthorizeUrl,
  isOAuthConfigured,
  OAUTH_REDIRECT_COOKIE,
  OAUTH_STATE_COOKIE,
} from "@/lib/instagram-oauth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { resolveRequestOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

/**
 * Kicks off "Connect Instagram": redirects to Meta's authorize screen with the
 * app's client id. The state value is stored in an HttpOnly cookie and checked
 * by the callback so a third-party page cannot complete a flow for the user.
 */
export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "social:oauth", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth?next=/publishing", req.url));
  }

  const settings = getSocialSettings(user.id);
  const creds = { appId: settings.metaAppId, appSecret: settings.rawMetaAppSecret };

  const origin = resolveRequestOrigin(req);

  if (!isOAuthConfigured(creds)) {
    // This is a browser navigation, so answer with a readable banner rather
    // than a JSON body the user would have to interpret.
    const url = new URL("/publishing", origin);
    url.searchParams.set("connect", "error");
    url.searchParams.set(
      "message",
      "Add your Meta app id and secret first — open “Advanced” on this page, paste both, press Save, then Connect Instagram again."
    );
    return NextResponse.redirect(url);
  }

  const redirectUri = `${origin}/api/social/instagram/oauth/callback`;
  const state = crypto.randomBytes(24).toString("base64url");

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ appId: creds.appId, redirectUri, state })
  );
  // Remember the exact redirect_uri used, so the callback sends Meta the same
  // value even if the proxy headers differ between the two requests.
  res.cookies.set(OAUTH_REDIRECT_COOKIE, redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
