import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings, updateSocialSettings } from "@/lib/db";
import { resolveRequestOrigin } from "@/lib/request-origin";
import { verifyYouTubeChannel } from "@/lib/youtube";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "yt_oauth_state";
const REDIRECT_COOKIE = "yt_oauth_redirect";
const TOKEN_URL =
  process.env.YT_OAUTH_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token";

function readCookie(req: Request, name: string): string | undefined {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = resolveRequestOrigin(req);
  const back = (ok: boolean, message?: string) => {
    const target = new URL("/publishing", origin);
    target.searchParams.set("connect", ok ? "ok" : "error");
    if (message) target.searchParams.set("message", message);
    return NextResponse.redirect(target);
  };

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/auth?next=/publishing", origin));

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return back(false, url.searchParams.get("error_description") || oauthError);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(req, STATE_COOKIE);
  if (!code) return back(false, "Google did not return an authorization code.");
  if (!state || !expectedState || state !== expectedState) {
    return back(false, "Sign-in expired or was started in another tab. Connect again.");
  }

  const settings = getSocialSettings(user.id);
  const redirectUri =
    readCookie(req, REDIRECT_COOKIE) || `${origin}/api/social/youtube/oauth/callback`;

  try {
    const form = new URLSearchParams({
      code,
      client_id: settings.youtubeClientId,
      client_secret: settings.rawYouTubeClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || !payload.refresh_token) {
      const detail = String(
        payload.error_description || payload.error || `HTTP ${res.status}`
      );
      return back(
        false,
        payload.refresh_token
          ? detail
          : `Google did not return a refresh token (${detail}). Remove this app from your Google account permissions and connect again.`
      );
    }

    updateSocialSettings(user.id, {
      youtubeRefreshToken: String(payload.refresh_token),
    });

    // Resolve the channel name so the UI can show what it connected to.
    const check = await verifyYouTubeChannel({
      clientId: settings.youtubeClientId,
      clientSecret: settings.rawYouTubeClientSecret,
      refreshToken: String(payload.refresh_token),
    });
    if (check.ok && check.channel) {
      updateSocialSettings(user.id, {
        youtubeChannelId: check.channel.id,
        youtubeChannelTitle: check.channel.title,
      });
    }

    const done = back(true);
    done.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
    done.cookies.set(REDIRECT_COOKIE, "", { path: "/", maxAge: 0 });
    return done;
  } catch (err) {
    return back(
      false,
      err instanceof Error ? err.message : "YouTube connection failed."
    );
  }
}
