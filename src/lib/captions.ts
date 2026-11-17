import type { ClipRecord } from "./types";

/**
 * Builds an Instagram caption from the clip's own data.
 *
 * Deliberately local and deterministic: no external model calls, no API keys,
 * and the result is shown to the user before publishing.
 */

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_MAX_HASHTAGS = 30;

const DEFAULT_HASHTAGS = "#gaming #gamingclips #reels #clipxai";

export interface CaptionOptions {
  hashtags?: string;
  includeScore?: boolean;
  includeChannel?: boolean;
  extra?: string;
}

function cleanTitle(title: string): string {
  return title
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\[\s*\]|\(\s*\)/g, "")
    .trim();
}

/** Keeps only well-formed hashtags, deduped, capped at 30 (Instagram's limit). */
export function normalizeHashtags(input: string | undefined): string[] {
  const raw = (input ?? DEFAULT_HASHTAGS).split(/[\s,]+/);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of raw) {
    if (!token) continue;
    const tag = token.startsWith("#") ? token : `#${token}`;
    const normalized = tag.replace(/[^#\p{L}\p{N}_]/gu, "");
    if (normalized.length < 2 || normalized === "#") continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= INSTAGRAM_MAX_HASHTAGS) break;
  }

  return result;
}

function triggerLine(clip: ClipRecord): string | null {
  const reason = clip.triggerReason?.trim();
  if (!reason) return null;
  // Trigger reasons can be long internal descriptions; keep the first clause.
  const short = reason.split(/[.;(]/)[0]?.trim();
  if (!short) return null;
  return short.length > 90 ? `${short.slice(0, 87)}…` : short;
}

export function buildInstagramCaption(
  clip: ClipRecord,
  options: CaptionOptions = {}
): string {
  const title = cleanTitle(clip.title) || "New highlight";
  const lines: string[] = [];

  lines.push(`${title} 🎮`);

  const meta: string[] = [];
  if (clip.gameName) meta.push(clip.gameName);
  if (options.includeChannel && clip.channelName) meta.push(`via ${clip.channelName}`);
  if (options.includeScore !== false) meta.push(`AI hype ${clip.aiScore}/100`);
  if (meta.length > 0) lines.push("", meta.join(" · "));

  const trigger = triggerLine(clip);
  if (trigger) lines.push("", trigger);

  const extra = options.extra?.trim();
  if (extra) lines.push("", extra);

  const hashtags = normalizeHashtags(options.hashtags);
  if (hashtags.length > 0) lines.push("", hashtags.join(" "));

  let caption = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  if (caption.length > INSTAGRAM_CAPTION_MAX) {
    // Trim the body but never lose the hashtags.
    const tagBlock = hashtags.join(" ");
    const budget = INSTAGRAM_CAPTION_MAX - tagBlock.length - 2;
    const body = caption.slice(0, Math.max(0, budget)).trimEnd();
    caption = `${body}…\n\n${tagBlock}`;
  }

  return caption;
}

/**
 * Reels ingest requirements (Meta):
 * MP4/MOV, H.264 or HEVC, AAC audio, 3 s–15 min, ≤1 GB, vertical preferred.
 */
export interface ReelsValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateReelsVideo(params: {
  width: number;
  height: number;
  durationSeconds: number;
  fileSizeBytes: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
}): ReelsValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (params.durationSeconds < 3) {
    errors.push(
      `Clip is ${params.durationSeconds.toFixed(1)}s — Reels require at least 3 seconds.`
    );
  }
  if (params.durationSeconds > 900) {
    errors.push("Clip is longer than 15 minutes — Reels cap out at 900 seconds.");
  }
  if (params.fileSizeBytes > 1024 ** 3) {
    errors.push("File is larger than 1 GB, which Instagram rejects.");
  }
  const codec = params.videoCodec.toLowerCase();
  if (codec && !["h264", "hevc"].includes(codec)) {
    errors.push(`Video codec '${params.videoCodec}' is not supported — Reels need H.264 or HEVC.`);
  }
  if (params.hasAudio && params.audioCodec) {
    const audio = params.audioCodec.toLowerCase();
    if (!["aac", "mp3"].includes(audio)) {
      warnings.push(
        `Audio codec '${params.audioCodec}' may be rejected; AAC is the safe choice.`
      );
    }
  }
  if (params.height < params.width) {
    warnings.push(
      "This is a landscape clip. Reels display 9:16 best — the vertical Short is preferred for auto-publish."
    );
  } else if (params.width > 0 && params.height > 0) {
    const ratio = params.width / params.height;
    if (ratio > 0.6 || ratio < 0.5) {
      warnings.push(
        `Aspect ratio is ${ratio.toFixed(2)}:1; 9:16 (0.5625) fills the Reels frame without bars.`
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
