import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  countPublishedSince,
  createSocialPost,
  findSocialPostForClip,
  getDb,
  getSocialSettings,
  mapClipRow,
  updateSocialPost,
  type SocialPost,
} from "./db";
import { broadcastWs } from "./ws";
import { probeMedia } from "./ffmpeg";
import { buildInstagramCaption, validateReelsVideo } from "./captions";
import {
  getPublishQuota,
  isInstagramConfigured,
  publishReel,
  resolveInstagramConfig,
  verifyInstagramAccount,
  type InstagramConfig,
} from "./instagram";
import { resolveObjectKey, uploadFile, type S3Config } from "./s3";
import { buildPublicMediaUrl, hostingWarning } from "./public-media";
import {
  buildYouTubeTitle,
  isYouTubeConfigured,
  uploadShort,
} from "./youtube";

const DAILY_PUBLISH_LIMIT = 50;
const MEDIA_URL_TTL_SECONDS = 24 * 60 * 60;

export interface PublishOutcome {
  ok: boolean;
  post?: SocialPost;
  error?: string;
  hint?: string;
  warnings?: string[];
  needsAttention?:
    | "instagram_not_configured"
    | "storage_not_configured"
    | "quota"
    | "invalid_media"
    | "account_not_eligible";
}

function storageConfigFrom(settings: ReturnType<typeof getSocialSettings>): S3Config {
  return {
    endpoint: settings.storageEndpoint,
    region: settings.storageRegion || "auto",
    bucket: settings.storageBucket,
    accessKeyId: settings.storageAccessKeyId,
    secretAccessKey: settings.rawStorageSecret,
    pathPrefix: settings.storagePrefix,
    publicBaseUrl: settings.storagePublicBaseUrl,
    forcePathStyle: settings.storageForcePathStyle,
  };
}

function instagramConfigFrom(settings: ReturnType<typeof getSocialSettings>): InstagramConfig {
  return resolveInstagramConfig({
    igUserId: settings.instagramUserId,
    accessToken: settings.rawInstagramToken,
    apiVersion: settings.instagramApiVersion,
    loginMethod: settings.instagramLoginMethod,
  });
}

/** Picks the vertical Short that pairs with a clip, when one exists. */
function resolveVerticalClip(clipId: string) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(clipId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const clip = mapClipRow(row);
  if (clip.aspectRatio === "9:16") {
    return { target: clip, original: clip, isShort: true };
  }

  const childRow = db
    .prepare(
      `SELECT * FROM clips WHERE parent_clip_id = ? AND aspect_ratio = '9:16'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(clipId) as Record<string, unknown> | undefined;

  if (childRow) {
    const child = mapClipRow(childRow);
    return { target: child, original: clip, isShort: true };
  }

  return { target: clip, original: clip, isShort: false };
}

/**
 * Full publish pipeline: validate → host publicly → create Reel → publish.
 * Records every state transition in `social_posts` so the UI can show progress
 * and retries are idempotent.
 */
export async function publishClipToInstagram(params: {
  clipId: string;
  userId: string | null;
  caption?: string;
  mode?: "auto" | "manual";
  /** Re-publish even if a successful post already exists for this clip. */
  force?: boolean;
}): Promise<PublishOutcome> {
  const { clipId, userId } = params;
  const mode = params.mode ?? "manual";

  if (!userId) {
    return {
      ok: false,
      error: "Sign in to publish clips to Instagram.",
    };
  }

  const settings = getSocialSettings(userId);
  if (!isInstagramConfigured(instagramConfigFrom(settings))) {
    return {
      ok: false,
      needsAttention: "instagram_not_configured",
      error:
        "Instagram is not connected yet. Add your Instagram Business/Creator account ID and access token in Settings → Instagram.",
    };
  }
  if (!settings.storageConfigured) {
    return {
      ok: false,
      needsAttention: "storage_not_configured",
      error:
        settings.storageMode === "builtin"
          ? "Set this app's public HTTPS URL under Publishing → Video hosting, or switch to an S3 bucket."
          : "Add your bucket endpoint, name, access key and secret under Publishing → Video hosting.",
    };
  }

  const hostWarning =
    settings.storageMode === "builtin"
      ? hostingWarning(settings.publicBaseUrl)
      : null;

  const resolved = resolveVerticalClip(clipId);
  if (!resolved) {
    return { ok: false, error: "Clip not found." };
  }
  const { target, isShort } = resolved;

  if (!params.force) {
    const existing = findSocialPostForClip(target.id);
    if (existing && (existing.status === "published" || existing.status === "processing" || existing.status === "creating" || existing.status === "hosting")) {
      return {
        ok: existing.status === "published",
        post: existing,
        error:
          existing.status === "published"
            ? undefined
            : "This clip is already being published.",
      };
    }
  }

  if (!target.filePath || !fs.existsSync(target.filePath)) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: "The rendered video file is missing on disk — re-render the clip first.",
    };
  }

  // --- validate against Reels requirements before touching the network ----
  let probe;
  try {
    probe = await probeMedia(target.filePath);
  } catch (err) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: `Could not inspect the video: ${
        err instanceof Error ? err.message : "ffprobe failed"
      }`,
    };
  }

  const validation = validateReelsVideo({
    width: probe.width,
    height: probe.height,
    durationSeconds: probe.durationSeconds,
    fileSizeBytes: probe.fileSizeBytes || fs.statSync(target.filePath).size,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    hasAudio: probe.hasAudio,
  });
  if (!validation.ok) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: `This video cannot be published as a Reel: ${validation.errors.join(" ")}`,
      warnings: validation.warnings,
    };
  }

  // --- account eligibility + token check --------------------------------
  // Verifying here (rather than guessing from publish errors) gives personal
  // accounts and expired tokens an actionable message before any upload.
  const account = await verifyInstagramAccount(instagramConfigFrom(settings));
  if (!account.ok) {
    return {
      ok: false,
      needsAttention: account.personalAccount
        ? "account_not_eligible"
        : "instagram_not_configured",
      error:
        account.error ||
        "Instagram rejected these credentials. Re-check the account ID and token in Settings → Instagram.",
    };
  }

  // --- quota guard -------------------------------------------------------
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const publishedLocally = countPublishedSince(userId, since);
  const remoteQuota = await getPublishQuota(instagramConfigFrom(settings));
  const remaining = remoteQuota
    ? Math.min(remoteQuota.remaining, DAILY_PUBLISH_LIMIT - publishedLocally)
    : DAILY_PUBLISH_LIMIT - publishedLocally;

  if (remaining <= 0) {
    return {
      ok: false,
      needsAttention: "quota",
      error:
        "Instagram's limit of 50 API-published posts per 24 hours has been reached. Try again later.",
    };
  }

  const caption =
    params.caption?.trim() ||
    buildInstagramCaption(target, {
      hashtags: settings.instagramHashtags,
      includeChannel: true,
    });

  let post = createSocialPost({
    id: `post-${crypto.randomUUID().slice(0, 10)}`,
    userId,
    clipId: target.id,
    mode,
    caption,
    status: "queued",
  });
  broadcastWs("social_post_updated", post);

  try {
    // --- 1. host the file publicly ---------------------------------------
    post = updateSocialPost(post.id, {
      status: "hosting",
      attempts: post.attempts + 1,
    })!;
    broadcastWs("social_post_updated", post);

    let uploaded: { publicUrl: string; expiresAt: string; key: string };

    if (settings.storageMode === "builtin") {
      // Served by this app with a signed, expiring URL — no bucket involved.
      const link = buildPublicMediaUrl(
        settings.publicBaseUrl,
        target.id,
        MEDIA_URL_TTL_SECONDS
      );
      uploaded = {
        publicUrl: link.url,
        expiresAt: link.expiresAt,
        key: `builtin:${target.id}`,
      };
    } else {
      const objectKeyName = `${isShort ? "shorts" : "clips"}/${userId}/${target.id}-${Date.now()}.mp4`;
      const put = await uploadFile({
        config: storageConfigFrom(settings),
        filePath: target.filePath,
        key: objectKeyName,
        contentType: "video/mp4",
        publicUrlTtlSeconds: MEDIA_URL_TTL_SECONDS,
      });
      uploaded = {
        publicUrl: put.publicUrl,
        expiresAt: put.expiresAt,
        key: resolveObjectKey(storageConfigFrom(settings), objectKeyName),
      };
    }

    post = updateSocialPost(post.id, {
      status: "creating",
      mediaKey: uploaded.key,
      mediaUrlExpiresAt: uploaded.expiresAt,
    })!;
    broadcastWs("social_post_updated", post);

    // --- 2. create + publish the Reel ------------------------------------
    const result = await publishReel(instagramConfigFrom(settings), {
      videoUrl: uploaded.publicUrl,
      caption,
      shareToFeed: settings.instagramShareToFeed,
      onStatus: (status) => {
        const mapped =
          status === "FINISHED" ? "processing" : "processing";
        if (post.status !== mapped) {
          const updated = updateSocialPost(post.id, { status: mapped });
          if (updated) {
            post = updated;
            broadcastWs("social_post_updated", post);
          }
        }
      },
    });

    post = updateSocialPost(post.id, {
      status: "published",
      containerId: result.containerId,
      remoteMediaId: result.mediaId,
      permalink: result.permalink || "",
      publishedAt: new Date().toISOString(),
      error: "",
    })!;
    broadcastWs("social_post_updated", post);

    return {
      ok: true,
      post,
      warnings: [...(validation.warnings || []), ...(hostWarning ? [hostWarning] : [])],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Publishing failed.";
    const hint = err instanceof Error && "hint" in err ? String((err as { hint?: string }).hint || "") : "";
    post = updateSocialPost(post.id, {
      status: "failed",
      error: message,
    })!;
    broadcastWs("social_post_updated", post);
    return { ok: false, post, error: message, hint: hint || undefined };
  }
}

/**
 * Fire-and-forget auto-publish used right after a Short is rendered.
 * Never throws and never blocks the capture pipeline.
 */
export function maybeAutoPublish(params: {
  clipId: string;
  userId: string | null;
  autoPublishOverride?: number;
}): void {
  const { clipId, userId } = params;
  if (!userId) return;

  try {
    const settings = getSocialSettings(userId);
    const enabledByStream = params.autoPublishOverride !== 0;
    if (!enabledByStream) return;

    const instagramEnabled =
      settings.instagramAutoPublish &&
      settings.instagramConfigured &&
      settings.storageConfigured;
    const youtubeEnabled = settings.youtubeAutoPublish && settings.youtubeConfigured;

    if (instagramEnabled && !findSocialPostForClip(clipId, "instagram")) {
      void publishClipToInstagram({ clipId, userId, mode: "auto" }).catch(() => {
        // The post row already records the failure for the UI.
      });
    }

    if (youtubeEnabled && !findSocialPostForClip(clipId, "youtube")) {
      void publishClipToYouTube({ clipId, userId, mode: "auto" }).catch(() => {
        // The post row already records the failure for the UI.
      });
    }
  } catch {
    // Auto-publish is best-effort by design.
  }
}

/** Convenience for tests/tools: absolute path of the clip's rendered file. */
export function clipFilePath(clipId: string): string | null {
  const row = getDb()
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(clipId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const clip = mapClipRow(row);
  return clip.filePath && fs.existsSync(path.resolve(clip.filePath))
    ? path.resolve(clip.filePath)
    : null;
}

/* ------------------------------------------------------------------------- */
/* YouTube Shorts                                                            */
/* ------------------------------------------------------------------------- */

const YOUTUBE_DAILY_LIMIT = 6;

function youtubeConfigFrom(settings: ReturnType<typeof getSocialSettings>) {
  return {
    clientId: settings.youtubeClientId,
    clientSecret: settings.rawYouTubeClientSecret,
    refreshToken: settings.rawYouTubeRefreshToken,
  };
}

/**
 * Uploads the vertical Short that pairs with a clip to YouTube.
 *
 * YouTube takes the bytes directly, so there is no hosting step — the pipeline
 * is validate → upload (resumable) → record. Same idempotency and per-clip
 * status tracking as Instagram, keyed by platform.
 */
export async function publishClipToYouTube(params: {
  clipId: string;
  userId: string | null;
  title?: string;
  description?: string;
  privacy?: "public" | "unlisted" | "private";
  mode?: "auto" | "manual";
  force?: boolean;
}): Promise<PublishOutcome> {
  const { clipId, userId } = params;
  const mode = params.mode ?? "manual";

  if (!userId) {
    return { ok: false, error: "Sign in to publish clips to YouTube." };
  }

  const settings = getSocialSettings(userId);
  if (!isYouTubeConfigured(youtubeConfigFrom(settings))) {
    return {
      ok: false,
      needsAttention: "instagram_not_configured",
      error:
        "YouTube is not connected yet. Open Publishing → YouTube and press Connect YouTube.",
    };
  }

  const resolved = resolveVerticalClip(clipId);
  if (!resolved) return { ok: false, error: "Clip not found." };
  const { target } = resolved;

  if (!params.force) {
    const existing = findSocialPostForClip(target.id, "youtube");
    if (
      existing &&
      ["published", "uploading", "processing", "creating", "hosting"].includes(
        existing.status
      )
    ) {
      return {
        ok: existing.status === "published",
        post: existing,
        error:
          existing.status === "published"
            ? undefined
            : "This clip is already being uploaded to YouTube.",
      };
    }
  }

  if (!target.filePath || !fs.existsSync(target.filePath)) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: "The rendered video file is missing on disk — re-render the clip first.",
    };
  }

  let probe;
  try {
    probe = await probeMedia(target.filePath);
  } catch (err) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: `Could not inspect the video: ${
        err instanceof Error ? err.message : "ffprobe failed"
      }`,
    };
  }

  const validation = validateReelsVideo({
    width: probe.width,
    height: probe.height,
    durationSeconds: probe.durationSeconds,
    fileSizeBytes: probe.fileSizeBytes || fs.statSync(target.filePath).size,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    hasAudio: probe.hasAudio,
  });
  if (!validation.ok) {
    return {
      ok: false,
      needsAttention: "invalid_media",
      error: `This video cannot be uploaded: ${validation.errors.join(" ")}`,
      warnings: validation.warnings,
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const uploadedToday = countPublishedSince(userId, since, "youtube");
  if (uploadedToday >= YOUTUBE_DAILY_LIMIT) {
    return {
      ok: false,
      needsAttention: "quota",
      error: `YouTube's free API quota allows about ${YOUTUBE_DAILY_LIMIT} uploads per day (1,600 units each). Try again after midnight Pacific, or raise the quota in Google Cloud.`,
    };
  }

  const title = (params.title?.trim() || buildYouTubeTitle(target)).slice(0, 100);
  const description =
    params.description?.trim() ||
    buildInstagramCaption(target, {
      hashtags: settings.instagramHashtags,
      includeChannel: true,
    });

  let post = createSocialPost({
    id: `post-${crypto.randomUUID().slice(0, 10)}`,
    userId,
    clipId: target.id,
    platform: "youtube",
    mode,
    caption: title,
    status: "queued",
  });
  broadcastWs("social_post_updated", post);

  try {
    post = updateSocialPost(post.id, {
      status: "uploading",
      attempts: post.attempts + 1,
    })!;
    broadcastWs("social_post_updated", post);

    const result = await uploadShort(youtubeConfigFrom(settings), {
      filePath: target.filePath,
      title,
      description,
      privacyStatus: params.privacy ?? settings.youtubePrivacy,
      categoryId: settings.youtubeCategoryId,
      madeForKids: settings.youtubeMadeForKids,
    });

    post = updateSocialPost(post.id, {
      status: "published",
      remoteMediaId: result.videoId,
      permalink: result.permalink,
      publishedAt: new Date().toISOString(),
      error: "",
    })!;
    broadcastWs("social_post_updated", post);

    return { ok: true, post, warnings: validation.warnings };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "YouTube upload failed.";
    const hint =
      err instanceof Error && "hint" in err
        ? String((err as { hint?: string }).hint || "")
        : "";
    post =
      updateSocialPost(post.id, {
        status: "failed",
        error: hint ? `${message} — ${hint}` : message,
      }) ?? post;
    broadcastWs("social_post_updated", post);
    return { ok: false, post, error: message, hint };
  }
}
