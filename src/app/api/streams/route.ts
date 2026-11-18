import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb, getEffectiveSettings, mapStreamRow } from "@/lib/db";
import {
  getAllBufferStates,
  startStreamMonitoring,
} from "@/lib/monitor-engine";
import { verifyAuthorizedStream } from "@/lib/platform-api";
import type { StreamPlatform } from "@/lib/types";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const AddStreamSchema = z.object({
  streamUrl: z
    .string()
    .trim()
    .min(2, "Enter a channel name, @handle, or live stream URL.")
    .max(600),
  platform: z.enum(["twitch", "youtube", "kick", "hls"]).optional(),
  title: z.string().max(120).optional(),
  gameName: z.string().max(80).optional(),
  isAuthorized: z.boolean().optional().default(true),
  autoStart: z.boolean().optional().default(true),
  postBufferSeconds: z.number().int().min(3).max(40).optional(),
  hypeThreshold: z.number().int().min(30).max(95).optional(),
  videoQuality: z
    .enum(["1080p_source", "1080p_high", "720p_balanced"])
    .optional(),
  shortsLayout: z.enum(["fit_blur", "split_cam", "zoom_crop"]).optional(),
  autoShortsEnabled: z.boolean().optional(),
  autoDownloadEnabled: z.boolean().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM streams
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY is_demo ASC, created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const settings = getEffectiveSettings(user?.id ?? null);

  return NextResponse.json({
    streams: rows.map(mapStreamRow),
    buffers: getAllBufferStates(),
    platformStatus: {
      keylessEnabled: true,
      twitchConfigured: settings.twitchConfigured,
      youtubeConfigured: settings.youtubeConfigured,
      kickConfigured: settings.kickConfigured,
      hlsSupported: true,
      uploadSupported: true,
    },
  });
}

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "streams:create", 12, 5 * 60_000);
  if (limited) return limited;
  try {
    const body = await req.json();
    const parsed = AddStreamSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid stream input." },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        {
          error:
            "Sign in to connect and monitor a live stream. Use the demo account for a zero-setup tour.",
        },
        { status: 401 }
      );
    }
    const settings = getEffectiveSettings(user.id);

    const check = await verifyAuthorizedStream({
      url: parsed.data.streamUrl,
      preferredPlatform: parsed.data.platform as StreamPlatform | undefined,
      customTitle: parsed.data.title,
      gameName: parsed.data.gameName,
      twitchClientId: settings.twitchClientId,
      twitchAccessToken: settings.rawTwitchToken,
      youtubeApiKey: settings.rawYoutubeKey,
      kickApiToken: settings.rawKickToken,
    });

    const db = getDb();
    const now = new Date().toISOString();
    const postBuf = parsed.data.postBufferSeconds ?? settings.postBufferSeconds;
    const hypeThresh = parsed.data.hypeThreshold ?? settings.hypeThreshold;
    const vidQuality = parsed.data.videoQuality ?? settings.videoQuality ?? "1080p_source";
    const sLayout = parsed.data.shortsLayout ?? settings.shortsLayout ?? "fit_blur";
    const autoShorts = parsed.data.autoShortsEnabled ?? settings.autoShortsEnabled;
    const autoDl = parsed.data.autoDownloadEnabled ?? settings.autoDownloadEnabled;
    const previewUrl =
      check.previewImageUrl ||
      (check.platform === "hls" &&
      check.isLiveVerified &&
      check.canonicalUrl.toLowerCase().endsWith(".mp4")
        ? check.canonicalUrl
        : null);

    // If this exact stream URL already exists for this user, refresh it instead of duplicating
    const existingRow = db
      .prepare(
        `SELECT * FROM streams
         WHERE is_demo = 0 AND LOWER(stream_url) = LOWER(?)
           AND (user_id IS NULL OR user_id = ?)
         LIMIT 1`
      )
      .get(check.canonicalUrl, user.id) as
      | Record<string, unknown>
      | undefined;

    let streamId: string;
    if (existingRow) {
      streamId = String(existingRow.id);
      db.prepare(
        `UPDATE streams
         SET title = ?, channel_name = ?, game_name = ?, local_source_path = ?,
             preview_video_url = ?, status = CASE WHEN status = 'monitoring' THEN 'monitoring' ELSE ? END,
             status_reason = ?, is_authorized = ?, viewer_count = ?, post_buffer_seconds = ?,
             hype_threshold = ?, video_quality = ?, shorts_layout = ?,
             auto_shorts_enabled = ?, auto_download_enabled = ?
         WHERE id = ?`
      ).run(
        check.title,
        check.channelName,
        check.gameName,
        check.sourceDescriptor,
        previewUrl,
        check.status,
        check.statusReason,
        parsed.data.isAuthorized ? 1 : 0,
        check.viewerCount,
        postBuf,
        hypeThresh,
        vidQuality,
        sLayout,
        autoShorts ? 1 : 0,
        autoDl ? 1 : 0,
        streamId
      );
    } else {
      streamId = `stream-${crypto.randomUUID().slice(0, 10)}`;
      db.prepare(
        `INSERT INTO streams (
          id, user_id, title, channel_name, game_name, platform, stream_url,
          local_source_path, preview_video_url, status, status_reason,
          is_demo, is_authorized, viewer_count, pre_buffer_seconds, post_buffer_seconds,
          min_ai_score, hype_threshold, video_quality, shorts_layout,
          auto_shorts_enabled, auto_download_enabled,
          dedupe_cooldown_seconds, last_clip_event_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 20, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`
      ).run(
        streamId,
        user.id,
        check.title,
        check.channelName,
        check.gameName,
        check.platform,
        check.canonicalUrl,
        check.sourceDescriptor,
        previewUrl,
        check.status,
        check.statusReason,
        parsed.data.isAuthorized ? 1 : 0,
        check.viewerCount,
        postBuf,
        settings.minAiScore,
        hypeThresh,
        vidQuality,
        sLayout,
        autoShorts ? 1 : 0,
        autoDl ? 1 : 0,
        settings.dedupeCooldownSeconds,
        now
      );
    }

    // Auto-start the 20s live rolling buffer & keyless live chat when verified LIVE!
    let activeBuffer = null;
    if (check.isLiveVerified && parsed.data.autoStart) {
      try {
        const started = await startStreamMonitoring(streamId, user.id);
        activeBuffer = started.buffer;
      } catch {
        // leave stream in 'ready' status so user can click Start manually
      }
    }

    const row = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(streamId) as Record<string, unknown>;

    return NextResponse.json(
      {
        stream: mapStreamRow(row),
        buffer: activeBuffer,
        isLiveVerified: check.isLiveVerified,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to connect live stream.",
      },
      { status: 400 }
    );
  }
}
