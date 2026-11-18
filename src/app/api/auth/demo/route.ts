import { NextResponse } from "next/server";
import { createSessionToken, setSessionCookie } from "@/lib/auth";
import { getDb, getEffectiveSettings, mapUserRow } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (process.env.CLIPX_DISABLE_DEMO_ACCOUNT === "true") {
    return NextResponse.json(
      {
        error:
          "The shared demo account is disabled on this deployment. Please create your own account.",
      },
      { status: 403 }
    );
  }

  const limited = enforceRateLimit(req, "auth:demo", 20, 5 * 60_000);
  if (limited) return limited;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM users WHERE id = 'user-demo'")
    .get() as Record<string, unknown> | undefined;

  if (!row) {
    return NextResponse.json(
      { error: "Demo creator account not found." },
      { status: 404 }
    );
  }

  const user = mapUserRow(row);
  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...settings } =
    getEffectiveSettings(user.id);
  void rawTwitchToken;
  void rawYoutubeKey;
  void rawKickToken;

  return NextResponse.json({ user, settings, authProvider: "demo" });
}
