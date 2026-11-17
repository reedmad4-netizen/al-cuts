import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings, updateSocialSettings } from "@/lib/db";
import {
  exchangeCodeForToken,
  isOAuthConfigured,
  OAUTH_STATE_COOKIE,
  OAuthError,
} from "@/lib/instagram-oauth";

export const dynamic = "force-dynamic";

function back(origin: string, params: Record<string, string>) {
  const url = new URL("/publishing", origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth?next=/publishing", origin));
  }

  const error = url.searchParams.get("error") || url.searchParams.get("error_description");
  if (error) {
    return back(origin, { connect: "error", message: error });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OAUTH_STATE_COOKIE}=`))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);

  if (!code) {
    return back(origin, { connect: "error", message: "Instagram did not return an authorization code." });
  }
  if (!state || !expectedState || state !== expectedState) {
    return back(origin, {
      connect: "error",
      message: "Sign-in expired or was started in another tab. Press Connect Instagram again.",
    });
  }

  const settings = getSocialSettings(user.id);
  const creds = { appId: settings.metaAppId, appSecret: settings.rawMetaAppSecret };
  if (!isOAuthConfigured(creds)) {
    return back(origin, { connect: "error", message: "Meta app credentials are missing." });
  }

  try {
    const result = await exchangeCodeForToken({
      code,
      redirectUri: `${origin}/api/social/instagram/oauth/callback`,
      creds,
    });

    updateSocialSettings(user.id, {
      instagramUserId: result.igUserId,
      instagramAccessToken: result.accessToken,
      instagramTokenExpiresAt: result.expiresAt,
      instagramLoginMethod: "instagram",
    });

    const res = back(origin, { connect: "ok" });
    res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  } catch (err) {
    const message =
      err instanceof OAuthError || err instanceof Error
        ? err.message
        : "Instagram sign-in failed.";
    return back(origin, { connect: "error", message });
  }
}
