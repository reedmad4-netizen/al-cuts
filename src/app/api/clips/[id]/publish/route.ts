import { NextResponse } from "next/server";
import { z } from "zod";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import { getDb, mapClipRow } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  publishClipToInstagram,
  publishClipToYouTube,
  type PublishOutcome,
} from "@/lib/social-publish";

export const dynamic = "force-dynamic";

const PublishSchema = z.object({
  platform: z.enum(["instagram", "youtube", "both"]).default("instagram"),
  caption: z.string().max(4900).optional(),
  force: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const limited = enforceRateLimit(req, "social:publish", 60, 10 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to publish clips." },
      { status: 401 }
    );
  }

  const parsed = PublishSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid publish request." },
      { status: 400 }
    );
  }

  const row = getDb()
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  const clip = mapClipRow(row);
  const access = canUserExportClip(clip, user);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }
  if (clip.userId && clip.userId !== user.id) {
    return NextResponse.json(
      { error: "You can only publish your own clips." },
      { status: 403 }
    );
  }

  const platform = parsed.data.platform;

  if (platform === "both") {
    const [instagram, youtube] = await Promise.all([
      publishClipToInstagram({
        clipId: id,
        userId: user.id,
        caption: parsed.data.caption,
        mode: "manual",
        force: parsed.data.force,
      }),
      publishClipToYouTube({
        clipId: id,
        userId: user.id,
        description: parsed.data.caption,
        mode: "manual",
        force: parsed.data.force,
      }),
    ]);
    const ok = instagram.ok || youtube.ok;
    return NextResponse.json(
      { ok, instagram, youtube, post: instagram.post || youtube.post },
      { status: ok ? 200 : 400 }
    );
  }

  const result: PublishOutcome =
    platform === "youtube"
      ? await publishClipToYouTube({
          clipId: id,
          userId: user.id,
          description: parsed.data.caption,
          mode: "manual",
          force: parsed.data.force,
        })
      : await publishClipToInstagram({
          clipId: id,
          userId: user.id,
          caption: parsed.data.caption,
          mode: "manual",
          force: parsed.data.force,
        });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
