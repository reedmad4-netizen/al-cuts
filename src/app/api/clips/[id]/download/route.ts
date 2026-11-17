import crypto from "node:crypto";
import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapClipRow,
  saveClipToExportsFolder,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const ack = searchParams.get("ackCopyright") === "1";
  const skipLog = searchParams.get("skipLog") === "1";

  const user = await getCurrentUser();
  const settings = getEffectiveSettings(user?.id ?? null);
  const db = getDb();

  const row = db
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

  // Enforce pre-export warning confirmation on clips flagged for potentially copyrighted music
  if (
    clip.music.flagged &&
    settings.warnBeforeCopyrightExport &&
    !ack
  ) {
    return NextResponse.json(
      {
        error:
          "Copyright warning acknowledgment required before exporting this clip. Original audio is intact.",
        requiresCopyrightAck: true,
        music: clip.music,
      },
      { status: 409 }
    );
  }

  if (!fs.existsSync(clip.filePath)) {
    return NextResponse.json(
      { error: "MP4 video file is missing on server storage." },
      { status: 404 }
    );
  }

  const stat = fs.statSync(clip.filePath);

  const variant: "original" | "short_9x16" | "square_1x1" | "edited" =
    clip.aspectRatio === "9:16"
      ? "short_9x16"
      : clip.aspectRatio === "1:1"
      ? "square_1x1"
      : clip.isEdited
      ? "edited"
      : "original";

  // Record export + save copy to clipx-ai/exports/ (unless already logged by auto-export / pair export)
  if (!skipLog) {
    const exported = saveClipToExportsFolder({
      sourceFilePath: clip.filePath,
      channelName: clip.channelName,
      gameName: clip.gameName,
      variant,
    });

    db.prepare(
      `INSERT INTO clip_downloads (
        id, clip_id, user_id, clip_title, format, aspect_ratio,
        file_size_bytes, copyright_acknowledged, saved_export_path, is_demo, downloaded_at
      ) VALUES (?, ?, ?, ?, 'mp4', ?, ?, ?, ?, ?, ?)`
    ).run(
      `dl-${crypto.randomUUID().slice(0, 10)}`,
      clip.id,
      user?.id ?? null,
      clip.title,
      clip.aspectRatio,
      stat.size,
      ack ? 1 : 0,
      exported?.relativePath ?? null,
      clip.isDemo ? 1 : 0,
      new Date().toISOString()
    );
  }

  const safeChannel =
    clip.channelName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 26) || "stream";
  const safeGame =
    clip.gameName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 22) || "live";
  const variantTag =
    variant === "short_9x16"
      ? "SHORT_9x16"
      : variant === "square_1x1"
      ? "SQUARE_1x1"
      : variant === "edited"
      ? "EDITED_16x9"
      : "ORIGINAL_16x9";
  const stamp = clip.createdAt.slice(0, 19).replace(/[:]/g, "-");
  const filename = `${safeChannel}_${safeGame}_${stamp}_${variantTag}.mp4`;

  const nodeStream = fs.createReadStream(clip.filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
