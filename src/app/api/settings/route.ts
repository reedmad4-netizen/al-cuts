import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapClipRow,
  mapDownloadRow,
  mapUserRow,
  seedDemoData,
  stripInternalClipPaths,
} from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const db = getDb();
  const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...settings } =
    getEffectiveSettings(user?.id ?? null);
  void rawTwitchToken;
  void rawYoutubeKey;
  void rawKickToken;

  const clipHistoryRows = db
    .prepare(
      `SELECT * FROM clips
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const downloadRows = db
    .prepare(
      `SELECT * FROM clip_downloads
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY downloaded_at DESC
       LIMIT 15`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  return NextResponse.json({
    user,
    settings,
    supabaseConfigured: isSupabaseConfigured(),
    clipHistory: clipHistoryRows.map((r) =>
      stripInternalClipPaths(mapClipRow(r))
    ),
    downloadHistory: downloadRows.map(mapDownloadRow),
  });
}

const UpdateSettingsSchema = z.object({
  action: z.enum(["save", "reset_demo"]).default("save"),
  displayName: z.string().min(2).max(60).optional(),
  handle: z.string().min(1).max(32).optional(),
  bio: z.string().max(240).optional(),
  postBufferSeconds: z.number().int().min(3).max(40).optional(),
  minAiScore: z.number().int().min(20).max(99).optional(),
  hypeThreshold: z.number().int().min(30).max(95).optional(),
  videoQuality: z
    .enum(["1080p_source", "1080p_high", "720p_balanced"])
    .optional(),
  shortsLayout: z.enum(["fit_blur", "split_cam", "zoom_crop"]).optional(),
  autoShortsEnabled: z.boolean().optional(),
  autoShortsCaption: z.boolean().optional(),
  autoDownloadEnabled: z.boolean().optional(),
  dedupeCooldownSeconds: z.number().int().min(10).max(120).optional(),
  chatSpikeMultiplier: z.number().min(1.5).max(8).optional(),
  defaultAspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  musicDetectionEnabled: z.boolean().optional(),
  warnBeforeCopyrightExport: z.boolean().optional(),
  showDemoData: z.boolean().optional(),
  twitchClientId: z.string().max(128).optional(),
  twitchAccessToken: z.string().max(256).optional(),
  youtubeApiKey: z.string().max(128).optional(),
  kickApiToken: z.string().max(256).optional(),
});

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const parsed = UpdateSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid settings payload." },
        { status: 400 }
      );
    }

    const db = getDb();
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to change settings." },
        { status: 401 }
      );
    }
    const d = parsed.data;

    if (d.action === "reset_demo") {
      seedDemoData(db, true);
      return NextResponse.json({
        ok: true,
        message: "Demo sample clips, chat activity, and sandbox stream reset.",
      });
    }

    // Update user profile if signed in
    let updatedUser = user;
    if (d.displayName || d.handle || d.bio !== undefined) {
      const cleanHandle = d.handle
        ? `@${d.handle.trim().replace(/^@+/, "")}`
        : user.handle;
      db.prepare(
        `UPDATE users SET display_name = ?, handle = ?, bio = ? WHERE id = ?`
      ).run(
        d.displayName?.trim() || user.displayName,
        cleanHandle,
        d.bio ?? user.bio,
        user.id
      );
      updatedUser = mapUserRow(
        db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as Record<
          string,
          unknown
        >
      );
    }

    const targetId = user.id;
    const current = getEffectiveSettings(targetId);

    const nextTwitchId =
      d.twitchClientId !== undefined ? d.twitchClientId.trim() : current.twitchClientId;
    const nextTwitchToken =
      d.twitchAccessToken !== undefined && d.twitchAccessToken !== "••••••••"
        ? d.twitchAccessToken.trim()
        : current.rawTwitchToken;
    const nextYtKey =
      d.youtubeApiKey !== undefined && d.youtubeApiKey !== "••••••••"
        ? d.youtubeApiKey.trim()
        : current.rawYoutubeKey;
    const nextKickToken =
      d.kickApiToken !== undefined && d.kickApiToken !== "••••••••"
        ? d.kickApiToken.trim()
        : current.rawKickToken;

    const nextPostBuf = d.postBufferSeconds ?? current.postBufferSeconds;
    const nextMinAi = d.minAiScore ?? current.minAiScore;
    const nextHype = d.hypeThreshold ?? current.hypeThreshold;
    const nextQuality = d.videoQuality ?? current.videoQuality ?? "1080p_source";
    const nextShortsLayout = d.shortsLayout ?? current.shortsLayout ?? "fit_blur";
    const nextAutoShorts = d.autoShortsEnabled ?? current.autoShortsEnabled;
    const nextAutoCaption = d.autoShortsCaption ?? current.autoShortsCaption;
    const nextAutoDownload =
      d.autoDownloadEnabled ?? current.autoDownloadEnabled;
    const nextCooldown =
      d.dedupeCooldownSeconds ?? current.dedupeCooldownSeconds;

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO user_settings (
        user_id, pre_buffer_seconds, post_buffer_seconds, min_ai_score,
        hype_threshold, video_quality, shorts_layout,
        auto_shorts_enabled, auto_shorts_caption, auto_download_enabled,
        dedupe_cooldown_seconds, chat_spike_multiplier, default_aspect_ratio,
        music_detection_enabled, warn_before_copyright_export, show_demo_data,
        twitch_client_id, twitch_access_token, youtube_api_key, kick_api_token, updated_at
      ) VALUES (?, 20, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        post_buffer_seconds = excluded.post_buffer_seconds,
        min_ai_score = excluded.min_ai_score,
        hype_threshold = excluded.hype_threshold,
        video_quality = excluded.video_quality,
        shorts_layout = excluded.shorts_layout,
        auto_shorts_enabled = excluded.auto_shorts_enabled,
        auto_shorts_caption = excluded.auto_shorts_caption,
        auto_download_enabled = excluded.auto_download_enabled,
        dedupe_cooldown_seconds = excluded.dedupe_cooldown_seconds,
        chat_spike_multiplier = excluded.chat_spike_multiplier,
        default_aspect_ratio = excluded.default_aspect_ratio,
        music_detection_enabled = excluded.music_detection_enabled,
        warn_before_copyright_export = excluded.warn_before_copyright_export,
        show_demo_data = excluded.show_demo_data,
        twitch_client_id = excluded.twitch_client_id,
        twitch_access_token = excluded.twitch_access_token,
        youtube_api_key = excluded.youtube_api_key,
        kick_api_token = excluded.kick_api_token,
        updated_at = excluded.updated_at`
    ).run(
      targetId,
      nextPostBuf,
      nextMinAi,
      nextHype,
      nextQuality,
      nextShortsLayout,
      nextAutoShorts ? 1 : 0,
      nextAutoCaption ? 1 : 0,
      nextAutoDownload ? 1 : 0,
      nextCooldown,
      d.chatSpikeMultiplier ?? current.chatSpikeMultiplier,
      d.defaultAspectRatio ?? current.defaultAspectRatio,
      (d.musicDetectionEnabled ?? current.musicDetectionEnabled) ? 1 : 0,
      (d.warnBeforeCopyrightExport ?? current.warnBeforeCopyrightExport) ? 1 : 0,
      (d.showDemoData ?? current.showDemoData) ? 1 : 0,
      nextTwitchId,
      nextTwitchToken,
      nextYtKey,
      nextKickToken,
      now
    );

    // Sync updated defaults onto demo sandbox stream & user streams
    if (
      d.postBufferSeconds !== undefined ||
      d.minAiScore !== undefined ||
      d.hypeThreshold !== undefined ||
      d.videoQuality !== undefined ||
      d.shortsLayout !== undefined ||
      d.autoShortsEnabled !== undefined ||
      d.autoDownloadEnabled !== undefined ||
      d.dedupeCooldownSeconds !== undefined
    ) {
      db.prepare(
        `UPDATE streams
         SET post_buffer_seconds = ?, min_ai_score = ?, hype_threshold = ?,
             video_quality = ?, shorts_layout = ?,
             auto_shorts_enabled = ?, auto_download_enabled = ?, dedupe_cooldown_seconds = ?
         WHERE id = 'stream-demo-sandbox' OR user_id = ? OR user_id IS NULL`
      ).run(
        nextPostBuf,
        nextMinAi,
        nextHype,
        nextQuality,
        nextShortsLayout,
        nextAutoShorts ? 1 : 0,
        nextAutoDownload ? 1 : 0,
        nextCooldown,
        targetId
      );
    }

    const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...fresh } =
      getEffectiveSettings(targetId);
    void rawTwitchToken;
    void rawYoutubeKey;
    void rawKickToken;

    return NextResponse.json({ user: updatedUser, settings: fresh });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save settings." },
      { status: 400 }
    );
  }
}
