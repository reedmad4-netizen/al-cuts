import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings, updateSocialSettings } from "@/lib/db";
import { refreshLongLivedToken } from "@/lib/instagram-oauth";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Refreshes a long-lived Instagram token in place so the 60-day expiry stops
 * being a chore. Tokens younger than 24h cannot be refreshed yet.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "social:refresh", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const settings = getSocialSettings(user.id);
  if (!settings.rawInstagramToken) {
    return NextResponse.json(
      { error: "Connect Instagram first." },
      { status: 400 }
    );
  }
  if (settings.instagramLoginMethod !== "instagram") {
    return NextResponse.json(
      {
        error:
          "Facebook Login tokens cannot be auto-refreshed. Re-connect from the Meta dashboard, or switch to the Instagram Login path.",
      },
      { status: 400 }
    );
  }

  try {
    const refreshed = await refreshLongLivedToken(settings.rawInstagramToken);
    updateSocialSettings(user.id, {
      instagramAccessToken: refreshed.accessToken,
      instagramTokenExpiresAt: refreshed.expiresAt,
    });
    return NextResponse.json({
      ok: true,
      expiresAt: refreshed.expiresAt,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Could not refresh the token.",
      },
      { status: 400 }
    );
  }
}
