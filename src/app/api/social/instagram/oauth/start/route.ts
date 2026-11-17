import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings } from "@/lib/db";
import {
  buildAuthorizeUrl,
  isOAuthConfigured,
  OAUTH_STATE_COOKIE,
} from "@/lib/instagram-oauth";
import { enforceRateLimit } from "@/lib/rate-limit";

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

  if (!isOAuthConfigured(creds)) {
    return NextResponse.json(
      {
        error:
          "One-click connect needs a Meta app id and secret. Add them under Advanced, or paste a token manually.",
        needs: "meta_app_credentials",
      },
      { status: 400 }
    );
  }

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/social/instagram/oauth/callback`;
  const state = crypto.randomBytes(24).toString("base64url");

  const res = NextResponse.redirect(
    buildAuthorizeUrl({ appId: creds.appId, redirectUri, state })
  );
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
