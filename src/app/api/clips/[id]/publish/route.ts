import { NextResponse } from "next/server";
import { z } from "zod";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import { getDb, mapClipRow } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { publishClipToInstagram } from "@/lib/social-publish";

export const dynamic = "force-dynamic";

const PublishSchema = z.object({
  platform: z.literal("instagram").default("instagram"),
  caption: z.string().max(2200).optional(),
  force: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const limited = enforceRateLimit(req, "social:publish", 10, 10 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to publish clips to Instagram." },
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

  const result = await publishClipToInstagram({
    clipId: id,
    userId: user.id,
    caption: parsed.data.caption,
    mode: "manual",
    force: parsed.data.force,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
