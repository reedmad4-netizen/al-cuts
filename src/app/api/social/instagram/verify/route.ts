import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings } from "@/lib/db";
import {
  getPublishQuota,
  isInstagramConfigured,
  resolveInstagramConfig,
  verifyInstagramAccount,
} from "@/lib/instagram";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Verifies the saved credentials: token validity, that the id is an Instagram
 * professional account, and the remaining publishing quota.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "social:verify", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to verify Instagram." }, { status: 401 });
  }

  const settings = getSocialSettings(user.id);
  const config = resolveInstagramConfig({
    igUserId: settings.instagramUserId,
    accessToken: settings.rawInstagramToken,
    apiVersion: settings.instagramApiVersion,
    loginMethod: settings.instagramLoginMethod,
  });

  if (!isInstagramConfigured(config)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Add your Instagram Business/Creator account ID and a long-lived access token first.",
      },
      { status: 400 }
    );
  }

  const account = await verifyInstagramAccount(config);
  const quota = account.ok ? await getPublishQuota(config) : null;

  return NextResponse.json(
    {
      ...account,
      quota,
      personalAccount: account.personalAccount ?? false,
      help:
        "Instagram publishing needs a Business or Creator account linked to a Facebook Page, " +
        "and a token with instagram_basic + instagram_content_publish. Personal accounts cannot publish via the API.",
    },
    { status: account.ok ? 200 : 400 }
  );
}
