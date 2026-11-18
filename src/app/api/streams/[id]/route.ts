import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canModifyStream, getCurrentUser } from "@/lib/auth";
import { getDb, getEffectiveSettings, mapStreamRow } from "@/lib/db";
import {
  startStreamMonitoring,
  stopStreamMonitoring,
} from "@/lib/monitor-engine";
import { verifyAuthorizedStream } from "@/lib/platform-api";

export const dynamic = "force-dynamic";

const UpdateStreamSchema = z.object({
  action: z.enum(["start", "stop", "recheck", "configure", "set_auth"]),
  postBufferSeconds: z.number().int().min(3).max(40).optional(),
  minAiScore: z.number().int().min(20).max(99).optional(),
  hypeThreshold: z.number().int().min(30).max(95).optional(),
  videoQuality: z
    .enum(["1080p_source", "1080p_high", "720p_balanced"])
    .optional(),
  shortsLayout: z.enum(["fit_blur", "split_cam", "zoom_crop"]).optional(),
  autoShortsEnabled: z.boolean().optional(),
  autoDownloadEnabled: z.boolean().optional(),
  dedupeCooldownSeconds: z.number().int().min(10).max(120).optional(),
  /** -1 inherit account default, 0 never, 1 always */
  autoPublishEnabled: z.number().int().min(-1).max(1).optional(),
  isAuthorized: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = UpdateStreamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid request." },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    const db = getDb();
    const existing = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Stream not found." }, { status: 404 });
    }
    const stream = mapStreamRow(existing);

    const access = canModifyStream(stream, user);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason },
        { status: user ? 403 : 401 }
      );
    }

    const qualityChanged =
      parsed.data.videoQuality !== undefined &&
      parsed.data.videoQuality !== stream.videoQuality;

    if (
      parsed.data.postBufferSeconds !== undefined ||
      parsed.data.minAiScore !== undefined ||
      parsed.data.hypeThreshold !== undefined ||
      parsed.data.videoQuality !== undefined ||
      parsed.data.shortsLayout !== undefined ||
      parsed.data.autoShortsEnabled !== undefined ||
      parsed.data.autoDownloadEnabled !== undefined ||
      parsed.data.dedupeCooldownSeconds !== undefined ||
      parsed.data.autoPublishEnabled !== undefined
    ) {
      db.prepare(
        `UPDATE streams
         SET post_buffer_seconds = ?, min_ai_score = ?, hype_threshold = ?,
             video_quality = ?, shorts_layout = ?,
             auto_shorts_enabled = ?, auto_download_enabled = ?, dedupe_cooldown_seconds = ?,
             auto_publish_enabled = ?
         WHERE id = ?`
      ).run(
        parsed.data.postBufferSeconds ?? stream.postBufferSeconds,
        parsed.data.minAiScore ?? stream.minAiScore,
        parsed.data.hypeThreshold ?? stream.hypeThreshold,
        parsed.data.videoQuality ?? stream.videoQuality,
        parsed.data.shortsLayout ?? stream.shortsLayout,
        (parsed.data.autoShortsEnabled ?? stream.autoShortsEnabled) ? 1 : 0,
        (parsed.data.autoDownloadEnabled ?? stream.autoDownloadEnabled) ? 1 : 0,
        parsed.data.dedupeCooldownSeconds ?? stream.dedupeCooldownSeconds,
        parsed.data.autoPublishEnabled ?? stream.autoPublishEnabled,
        id
      );

      // If quality changed while actively monitoring a live HLS stream, hot-swap ring buffer to new quality!
      if (
        qualityChanged &&
        parsed.data.action === "configure" &&
        stream.status === "monitoring" &&
        !stream.isDemo
      ) {
        stopStreamMonitoring(id);
        const restarted = await startStreamMonitoring(
          id,
          user?.id ?? null
        );
        return NextResponse.json(restarted);
      }
    }

    if (
      parsed.data.action === "set_auth" &&
      parsed.data.isAuthorized !== undefined
    ) {
      const authFlag = parsed.data.isAuthorized ? 1 : 0;
      db.prepare("UPDATE streams SET is_authorized = ? WHERE id = ?").run(
        authFlag,
        id
      );
      db.prepare(
        "UPDATE clips SET owner_authorized = ? WHERE stream_id = ? AND is_demo = 0"
      ).run(authFlag, id);
    }

    if (parsed.data.action === "start") {
      const result = await startStreamMonitoring(id, user?.id ?? null);
      return NextResponse.json(result);
    }

    if (parsed.data.action === "stop") {
      const stopped = stopStreamMonitoring(id);
      return NextResponse.json({ stream: stopped });
    }

    if (parsed.data.action === "recheck") {
      if (stream.isDemo || stream.platform === "upload") {
        return NextResponse.json({ stream });
      }
      if (stream.status === "monitoring") {
        stopStreamMonitoring(id);
      }
      const settings = getEffectiveSettings(user?.id ?? null);
      const check = await verifyAuthorizedStream({
        url: stream.streamUrl,
        preferredPlatform: stream.platform,
        twitchClientId: settings.twitchClientId,
        twitchAccessToken: settings.rawTwitchToken,
        youtubeApiKey: settings.rawYoutubeKey,
        kickApiToken: settings.rawKickToken,
      });
      db.prepare(
        `UPDATE streams
         SET status = ?, status_reason = ?, viewer_count = ?, title = ?,
             channel_name = ?, game_name = ?, stream_url = ?,
             local_source_path = ?, preview_video_url = COALESCE(?, preview_video_url)
         WHERE id = ?`
      ).run(
        check.status,
        check.statusReason,
        check.viewerCount,
        check.title,
        check.channelName,
        check.gameName,
        check.canonicalUrl,
        check.sourceDescriptor,
        check.previewImageUrl,
        id
      );
    }

    const updated = mapStreamRow(
      db.prepare("SELECT * FROM streams WHERE id = ?").get(id) as Record<
        string,
        unknown
      >
    );
    return NextResponse.json({ stream: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json({ error: "Stream not found." }, { status: 404 });
  }
  const stream = mapStreamRow(row);
  if (stream.isDemo) {
    return NextResponse.json(
      {
        error:
          "The built-in Demo Sandbox stream cannot be deleted, only stopped or hidden in Settings.",
      },
      { status: 400 }
    );
  }

  const user = await getCurrentUser();
  const access = canModifyStream(stream, user);
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason },
      { status: user ? 403 : 401 }
    );
  }

  try {
    stopStreamMonitoring(id);
  } catch {
    // ignore
  }

  if (
    stream.platform === "upload" &&
    stream.localSourcePath &&
    fs.existsSync(stream.localSourcePath)
  ) {
    fs.rmSync(stream.localSourcePath, { force: true });
  }

  db.prepare("DELETE FROM streams WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
