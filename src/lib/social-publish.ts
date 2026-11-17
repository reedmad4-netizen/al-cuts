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
        "No media host is configured. Instagram downloads videos from a public URL, so add your S3-compatible bucket credentials in Settings → Media hosting.",
    };
  }

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

    const objectKeyName = `${isShort ? "shorts" : "clips"}/${userId}/${target.id}-${Date.now()}.mp4`;
    const uploaded = await uploadFile({
      config: storageConfigFrom(settings),
      filePath: target.filePath,
      key: objectKeyName,
      contentType: "video/mp4",
      publicUrlTtlSeconds: MEDIA_URL_TTL_SECONDS,
    });

    post = updateSocialPost(post.id, {
      status: "creating",
      mediaKey: resolveObjectKey(storageConfigFrom(settings), objectKeyName),
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

    return { ok: true, post, warnings: validation.warnings };
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
    const enabled =
      enabledByStream &&
      settings.instagramAutoPublish &&
      settings.instagramConfigured &&
      settings.storageConfigured;
    if (!enabled) return;

    const existing = findSocialPostForClip(clipId);
    if (existing) return;

    void publishClipToInstagram({
      clipId,
      userId,
      mode: "auto",
    }).catch(() => {
      // The post row already records the failure for the UI.
    });
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
