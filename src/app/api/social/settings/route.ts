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
    ...rest
  } = settings;
  return {
    ...rest,
    instagramAccessToken: rawInstagramToken ? MASK : "",
    storageSecretAccessKey: rawStorageSecret ? MASK : "",
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

  updateSocialSettings(user.id, parsed.data);
  return NextResponse.json({ settings: publicShape(user.id) });
}
