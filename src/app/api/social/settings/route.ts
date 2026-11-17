import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings, updateSocialSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

const MASK = "••••••••";

function publicShape(userId: string) {
  const settings = getSocialSettings(userId);
  const {
    rawInstagramToken,
    rawStorageSecret,
    rawMetaAppSecret,
    rawYouTubeClientSecret,
    rawYouTubeRefreshToken,
    ...rest
  } = settings;
  return {
    ...rest,
    instagramAccessToken: rawInstagramToken ? MASK : "",
    storageSecretAccessKey: rawStorageSecret ? MASK : "",
    metaAppSecret: rawMetaAppSecret ? MASK : "",
    youtubeClientSecret: rawYouTubeClientSecret ? MASK : "",
    youtubeRefreshToken: rawYouTubeRefreshToken ? MASK : "",
    // Surfaced so the UI can explain exactly what is missing.
    instagramReady: rest.instagramConfigured,
    storageReady: rest.storageConfigured,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to manage publishing." }, { status: 401 });
  }
  return NextResponse.json({ settings: publicShape(user.id) });
}

const UpdateSchema = z.object({
  instagramUserId: z.string().max(64).optional(),
  instagramAccessToken: z.string().max(2048).optional(),
  instagramApiVersion: z.string().max(16).optional(),
  instagramLoginMethod: z.enum(["facebook", "instagram"]).optional(),
  instagramTokenExpiresAt: z.string().max(40).optional(),
  metaAppId: z.string().max(64).optional(),
  metaAppSecret: z.string().max(256).optional(),
  storageMode: z.enum(["builtin", "s3"]).optional(),
  publicBaseUrl: z.string().max(300).optional(),
  instagramAutoPublish: z.boolean().optional(),
  instagramShareToFeed: z.boolean().optional(),
  instagramHashtags: z.string().max(2000).optional(),
  storageEndpoint: z.string().max(300).optional(),
  storageRegion: z.string().max(64).optional(),
  storageBucket: z.string().max(128).optional(),
  storageAccessKeyId: z.string().max(256).optional(),
  storageSecretAccessKey: z.string().max(512).optional(),
  storagePrefix: z.string().max(128).optional(),
  storagePublicBaseUrl: z.string().max(300).optional(),
  storageForcePathStyle: z.boolean().optional(),
  youtubeClientId: z.string().max(200).optional(),
  youtubeClientSecret: z.string().max(300).optional(),
  youtubeRefreshToken: z.string().max(500).optional(),
  youtubeChannelId: z.string().max(64).optional(),
  youtubeChannelTitle: z.string().max(200).optional(),
  youtubePrivacy: z.enum(["public", "unlisted", "private"]).optional(),
  youtubeCategoryId: z.string().max(8).optional(),
  youtubeMadeForKids: z.boolean().optional(),
  youtubeAutoPublish: z.boolean().optional(),
});

export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to manage publishing." }, { status: 401 });
  }

  const parsed = UpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid publishing settings." },
      { status: 400 }
    );
  }

  // Saving from the browser is the most reliable moment to learn this app's
  // public origin — the UI sends it explicitly, otherwise the request origin is
  // used. Never overwrite an explicitly configured URL.
  const payload = { ...parsed.data };
  if (payload.publicBaseUrl === undefined) {
    const current = getSocialSettings(user.id);
    if (!current.publicBaseUrl) {
      const forwardedHost = req.headers.get("x-forwarded-host");
      const forwardedProto = req.headers.get("x-forwarded-proto");
      const origin = forwardedHost
        ? `${forwardedProto || "https"}://${forwardedHost}`
        : new URL(req.url).origin;
      payload.publicBaseUrl = origin;
    }
  }

  updateSocialSettings(user.id, payload);
  return NextResponse.json({ settings: publicShape(user.id) });
}
