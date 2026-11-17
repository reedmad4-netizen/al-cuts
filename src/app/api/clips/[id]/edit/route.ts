import crypto from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapClipRow,
  stripInternalClipPaths,
} from "@/lib/db";
import { analyzeMusicCopyright, renderEditedClip } from "@/lib/ffmpeg";
import { broadcastWs, upsertJob } from "@/lib/monitor-engine";

export const dynamic = "force-dynamic";

const EditSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  startTime: z.number().min(0),
  endTime: z.number().min(0.5),
  fullLength: z.boolean().optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  shortsLayout: z.enum(["fit_blur", "split_cam", "zoom_crop"]).optional(),
  quality: z
    .enum(["1080p_source", "1080p_high", "720p_balanced"])
    .optional(),
  cropOffsetX: z.number().min(-1).max(1).optional(),
  caption: z
    .object({
      text: z.string().max(140),
      position: z.enum(["top", "center", "bottom"]),
      style: z.enum(["pill", "bold", "blue"]),
      fontSize: z.enum(["sm", "md", "lg"]),
    })
    .nullable()
    .optional(),
  subtitles: z
    .array(
      z.object({
        id: z.string(),
        startTime: z.number().min(0),
        endTime: z.number().min(0),
        text: z.string().max(180),
      })
    )
    .max(40)
    .optional(),
  copyrightWarningAcknowledged: z.boolean().optional(),
  userPermittedMuteAudio: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const body = await req.json();
    const parsed = EditSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message || "Invalid video edit parameters.",
        },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM clips WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }

    const source = mapClipRow(row);
    const access = canUserExportClip(source, user);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    // Enforce pre-export warning acknowledgment if copyrighted music is flagged
    if (source.music.flagged && !parsed.data.copyrightWarningAcknowledged) {
      return NextResponse.json(
        {
          error:
            "This clip contains potentially copyrighted music. Please review and acknowledge the copyright warning before rendering an export.",
          requiresCopyrightAck: true,
        },
        { status: 409 }
      );
    }

    if (parsed.data.endTime - parsed.data.startTime < 1.0) {
      return NextResponse.json(
        { error: "End time must be at least 1.0 second after start time." },
        { status: 400 }
      );
    }

    const newClipId = `clip-edit-${crypto.randomUUID().slice(0, 8)}`;
    const newTitle =
      parsed.data.title?.trim() ||
      `${source.title.replace(/\s*\(\d+:\d+ Edit\)$/i, "")} (${
        parsed.data.aspectRatio
      } Edit)`;

    const outMp4Name = `${newClipId}.mp4`;
    const outPosterName = `${newClipId}.jpg`;
    const outMp4Path = path.join(
      process.cwd(),
      "public/media/generated",
      outMp4Name
    );
    const outPosterPath = path.join(
      process.cwd(),
      "public/media/generated",
      outPosterName
    );

    const settings = getEffectiveSettings(user?.id ?? null);
    const chosenQuality =
      parsed.data.quality ?? settings.videoQuality ?? "1080p_source";
    const chosenLayout =
      parsed.data.shortsLayout ?? settings.shortsLayout ?? "fit_blur";
    const resTag =
      chosenQuality === "720p_balanced" ? "720p HD" : "1080p60 Full HD";

    upsertJob({
      id: jobId,
      clipId: newClipId,
      title: newTitle,
      type: "video_edit",
      stage: `Rendering ${resTag} ${parsed.data.aspectRatio} MP4 via FFmpeg...`,
      progress: 12,
      status: "running",
      isDemo: source.isDemo,
      updatedAt: new Date().toISOString(),
    });

    const rendered = await renderEditedClip({
      inputPath: source.filePath,
      outputMp4Path: outMp4Path,
      outputPosterPath: outPosterPath,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      fullLength: parsed.data.fullLength,
      aspectRatio: parsed.data.aspectRatio,
      shortsLayout: chosenLayout,
      quality: chosenQuality,
      cropOffsetX: parsed.data.cropOffsetX ?? 0,
      caption: parsed.data.caption ?? null,
      subtitles: parsed.data.subtitles ?? [],
      // Strictly never alters audio unless user explicitly checked permission
      userPermittedMuteAudio: parsed.data.userPermittedMuteAudio === true,
      onProgress: (pct) => {
        upsertJob({
          id: jobId,
          clipId: newClipId,
          title: newTitle,
          type: "video_edit",
          stage: `FFmpeg rendering ${resTag} ${parsed.data.aspectRatio} (${pct}%)...`,
          progress: Math.min(92, Math.max(15, Math.round(pct * 0.9))),
          status: "running",
          isDemo: source.isDemo,
          updatedAt: new Date().toISOString(),
        });
      },
    });

    // Re-check music on rendered output (always non-destructive)
    const music =
      parsed.data.userPermittedMuteAudio === true
        ? {
            flagged: false,
            confidence: 0,
            trackMatch: "",
            details:
              "Audio muted by explicit user request during export. Original source clip remains untouched.",
            rmsDb: -90,
            crestFactor: 0,
            audioModified: true,
          }
        : await analyzeMusicCopyright(outMp4Path);

    // Shift saved subtitle timestamps relative to new trimmed clip start so re-editing aligns
    const normalizedSubs = (parsed.data.subtitles || [])
      .map((s, idx) => ({
        id: s.id || `sub-${idx + 1}`,
        startTime: Number(Math.max(0, s.startTime - parsed.data.startTime).toFixed(2)),
        endTime: Number(
          Math.min(
            rendered.durationSeconds,
            s.endTime - parsed.data.startTime
          ).toFixed(2)
        ),
        text: s.text,
      }))
      .filter((s) => s.endTime - s.startTime >= 0.15 && s.text.trim().length > 0);

    db.prepare(
      `INSERT INTO clips (
        id, user_id, stream_id, parent_clip_id, title, game_name, channel_name, platform,
        video_url, poster_url, file_path, poster_path, duration_seconds, pre_buffer_seconds,
        post_buffer_seconds, aspect_ratio, width, height, file_size_bytes, status,
        ai_score, score_chat, score_gameplay, score_reactions, score_events, score_engagement,
        trigger_reason, ai_summary, music_flagged, music_confidence, music_track_match,
        music_details, music_rms_db, music_crest_factor, audio_modified, caption_json,
        subtitles_json, is_edited, is_demo, owner_authorized, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, 'ready',
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, 1, ?, ?, ?
      )`
    ).run(
      newClipId,
      user?.id ?? source.userId,
      source.streamId,
      source.id,
      newTitle,
      source.gameName,
      source.channelName,
      source.platform,
      `/api/media/generated/${outMp4Name}`,
      `/api/media/generated/${outPosterName}`,
      outMp4Path,
      outPosterPath,
      rendered.durationSeconds,
      source.preBufferSeconds,
      source.postBufferSeconds,
      parsed.data.aspectRatio,
      rendered.width,
      rendered.height,
      rendered.fileSizeBytes,
      source.aiScore,
      source.scores.chatActivity,
      source.scores.gameplayMoments,
      source.scores.suddenReactions,
      source.scores.inGameEvents,
      source.scores.viewerEngagement,
      `Studio Edit (${parsed.data.aspectRatio}, ${parsed.data.startTime.toFixed(
        1
      )}s–${parsed.data.endTime.toFixed(1)}s) · ${source.triggerReason}`,
      source.aiSummary,
      music.flagged ? 1 : 0,
      music.confidence,
      music.trackMatch,
      music.details,
      music.rmsDb,
      music.crestFactor,
      music.audioModified ? 1 : 0,
      parsed.data.caption?.text?.trim()
        ? JSON.stringify(parsed.data.caption)
        : "",
      JSON.stringify(normalizedSubs),
      source.isDemo ? 1 : 0,
      source.ownerAuthorized ? 1 : 0,
      new Date().toISOString()
    );

    const newClip = stripInternalClipPaths(
      mapClipRow(
        db
          .prepare("SELECT * FROM clips WHERE id = ?")
          .get(newClipId) as Record<string, unknown>
      )
    );

    upsertJob({
      id: jobId,
      clipId: newClipId,
      title: newTitle,
      type: "video_edit",
      stage: `Export ready (${rendered.width}x${rendered.height}, ${rendered.durationSeconds}s MP4)`,
      progress: 100,
      status: "completed",
      isDemo: source.isDemo,
      updatedAt: new Date().toISOString(),
    });

    broadcastWs("clip_created", newClip);

    return NextResponse.json({ clip: newClip }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "FFmpeg video edit failed.";
    upsertJob({
      id: jobId,
      title: "Video Edit Render",
      type: "video_edit",
      stage: "Render failed",
      progress: 100,
      status: "failed",
      error: message,
      isDemo: false,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
