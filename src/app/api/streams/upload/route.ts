import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, getEffectiveSettings, mapStreamRow } from "@/lib/db";
import { probeMedia } from "@/lib/ffmpeg";
import { startStreamMonitoring } from "@/lib/monitor-engine";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "streams:upload", 6, 10 * 60_000);
  if (limited) return limited;
  try {
    // Authenticate first: never buffer or write bytes for an anonymous caller.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to upload gameplay footage." },
        { status: 401 }
      );
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const title = String(form.get("title") || "").trim();
    const gameName = String(form.get("gameName") || "Gameplay").trim();
    const channelName = String(form.get("channelName") || "").trim();
    const isAuthorized = form.get("isAuthorized") === "true";
    const autoStart = form.get("autoStart") !== "false";

    if (!isAuthorized) {
      return NextResponse.json(
        {
          error:
            "Please confirm that you own or have explicit permission to clip this gameplay video.",
        },
        { status: 400 }
      );
    }

    if (!file || file.size === 0) {
      return NextResponse.json(
        { error: "Please choose a gameplay video file (.mp4, .webm, or .mov)." },
        { status: 400 }
      );
    }

    // Cap uploads at 60 MB to stay well inside workspace limits
    if (file.size > 60 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Upload exceeds 60 MB limit. Please upload a shorter gameplay feed." },
        { status: 400 }
      );
    }

    const ext = path.extname(file.name).toLowerCase() || ".mp4";
    if (![".mp4", ".webm", ".mov", ".mkv"].includes(ext)) {
      return NextResponse.json(
        { error: "Unsupported format. Upload an MP4, WebM, MOV, or MKV video." },
        { status: 400 }
      );
    }

    const id = `stream-${crypto.randomUUID().slice(0, 10)}`;
    const fileName = `${id}${ext}`;
    const uploadsDir = path.join(process.cwd(), "public/media/uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
    const absPath = path.join(uploadsDir, fileName);

    const bytes = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, bytes);

    // Verify valid video stream with real FFprobe
    let info;
    try {
      info = await probeMedia(absPath);
    } catch (err) {
      fs.rmSync(absPath, { force: true });
      return NextResponse.json(
        {
          error: `Uploaded file is not a valid playable video: ${
            err instanceof Error ? err.message : "FFprobe error"
          }`,
        },
        { status: 400 }
      );
    }

    const settings = getEffectiveSettings(user.id);
    const db = getDb();
    const effectiveChannel =
      channelName || user.handle.replace(/^@/, "") || "authorized_creator";
    const effectiveTitle =
      title || file.name.replace(/\.[^.]+$/, "") || "Authorized Gameplay Feed";

    db.prepare(
      `INSERT INTO streams (
        id, user_id, title, channel_name, game_name, platform, stream_url,
        local_source_path, preview_video_url, status, status_reason,
        is_demo, is_authorized, viewer_count, pre_buffer_seconds, post_buffer_seconds,
        min_ai_score, hype_threshold, video_quality, shorts_layout,
        auto_shorts_enabled, auto_download_enabled,
        dedupe_cooldown_seconds, last_clip_event_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 'upload', ?, ?, ?, 'ready', ?, 0, 1, 1, 20, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`
    ).run(
      id,
      user.id,
      effectiveTitle,
      effectiveChannel,
      gameName || "Gameplay",
      `authorized-upload://${file.name}`,
      absPath,
      `/api/media/uploads/${fileName}`,
      `Verified authorized video source (${info.width}x${info.height}, ${info.durationSeconds}s ${info.videoCodec.toUpperCase()}). Real FFmpeg 20s Full HD buffer & peak detector ready.`,
      settings.postBufferSeconds,
      settings.minAiScore,
      settings.hypeThreshold,
      settings.videoQuality ?? "1080p_source",
      settings.shortsLayout ?? "fit_blur",
      settings.autoShortsEnabled ? 1 : 0,
      settings.autoDownloadEnabled ? 1 : 0,
      settings.dedupeCooldownSeconds,
      new Date().toISOString()
    );

    if (autoStart) {
      const started = await startStreamMonitoring(id, user.id);
      return NextResponse.json(
        {
          stream: started.stream,
          buffer: started.buffer,
          probe: info,
        },
        { status: 201 }
      );
    }

    const row = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(id) as Record<string, unknown>;
    return NextResponse.json(
      { stream: mapStreamRow(row), probe: info },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to ingest authorized gameplay file.",
      },
      { status: 500 }
    );
  }
}
