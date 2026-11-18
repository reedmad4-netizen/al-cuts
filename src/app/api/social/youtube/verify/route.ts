import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings, updateSocialSettings } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  isYouTubeConfigured,
  UPLOADS_PER_DAY,
  verifyYouTubeChannel,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "social:verify", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to verify YouTube." }, { status: 401 });
  }

  const settings = getSocialSettings(user.id);
  const config = {
    clientId: settings.youtubeClientId,
    clientSecret: settings.rawYouTubeClientSecret,
    refreshToken: settings.rawYouTubeRefreshToken,
  };

  if (!isYouTubeConfigured(config)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Connect YouTube first (or paste a refresh token under Advanced).",
      },
      { status: 400 }
    );
  }

  const result = await verifyYouTubeChannel(config);
  if (result.ok && result.channel) {
    updateSocialSettings(user.id, {
      youtubeChannelId: result.channel.id,
      youtubeChannelTitle: result.channel.title,
    });
  }

  return NextResponse.json(
    {
      ...result,
      quota: { uploadsPerDay: UPLOADS_PER_DAY },
      privacy: settings.youtubePrivacy,
    },
    { status: result.ok ? 200 : 400 }
  );
}
