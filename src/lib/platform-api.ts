import { probeMedia } from "./ffmpeg";
import {
  resolveKickLive,
  resolveTwitchLive,
  resolveYoutubeLive,
  selectBestHlsVariant,
} from "./live-sources";
import type { StreamPlatform, StreamStatus } from "./types";

export interface PlatformCheckResult {
  platform: StreamPlatform;
  channelName: string;
  title: string;
  gameName: string;
  status: StreamStatus;
  statusReason: string;
  viewerCount: number;
  isLiveVerified: boolean;
  canonicalUrl: string;
  sourceDescriptor: string | null;
  previewImageUrl: string | null;
}

export function normalizeStreamInput(
  rawInput: string,
  preferredPlatform?: StreamPlatform
): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Allow typing shorthand like "twitch.tv/shroud" or "youtube.com/@tenz/live"
  if (/^(www\.|m\.)?(twitch\.tv|youtube\.com|youtu\.be|kick\.com)\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // Allow typing bare channel username / handle when platform is selected
  const cleanHandle = trimmed.replace(/^@/, "");
  if (preferredPlatform === "twitch") {
    return `https://www.twitch.tv/${cleanHandle}`;
  }
  if (preferredPlatform === "youtube") {
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return `https://www.youtube.com/watch?v=${trimmed}`;
    }
    return `https://www.youtube.com/@${cleanHandle}/live`;
  }
  if (preferredPlatform === "kick") {
    return `https://kick.com/${cleanHandle}`;
  }
  return trimmed;
}

export function detectPlatformFromUrl(rawUrl: string): {
  platform: StreamPlatform | null;
  channelOrId: string;
} {
  try {
    const normalized = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    const u = new URL(normalized);
    const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
    const parts = u.pathname.split("/").filter(Boolean);
    const lowerPath = u.pathname.toLowerCase();

    // Direct HLS (.m3u8) or MP4 URLs (including Kick/AWS IVS/CloudFront playback URLs)
    if (
      (u.protocol === "https:" || u.protocol === "http:") &&
      (lowerPath.endsWith(".m3u8") ||
        lowerPath.endsWith(".mp4") ||
        lowerPath.includes(".m3u8"))
    ) {
      return {
        platform: "hls",
        channelOrId:
          parts[parts.length - 1]?.replace(/\.(m3u8|mp4)$/i, "") || "live-hls",
      };
    }

    if (host === "twitch.tv" || host === "player.twitch.tv") {
      const ch = u.searchParams.get("channel") || parts[0] || "";
      return { platform: "twitch", channelOrId: ch.toLowerCase() };
    }

    if (
      host === "youtube.com" ||
      host === "gaming.youtube.com" ||
      host === "youtu.be"
    ) {
      const vid =
        host === "youtu.be"
          ? parts[0] || ""
          : u.searchParams.get("v") ||
            (parts[0] === "live" || parts[0] === "embed"
              ? parts[1] || ""
              : parts[0] || "");
      return { platform: "youtube", channelOrId: vid };
    }

    if (host === "kick.com" || host === "player.kick.com") {
      return { platform: "kick", channelOrId: (parts[0] || "").toLowerCase() };
    }

    return { platform: null, channelOrId: "" };
  } catch {
    return { platform: null, channelOrId: "" };
  }
}

/**
 * Verifies live stream status & captures live stream source WITHOUT requiring any
 * API keys on Twitch, YouTube Live, Kick, or direct HLS (.m3u8) / MP4 feeds.
 * Optional user API keys in Settings are still supported as a supplement, and
 * CLIPX AI NEVER pretends an offline or unreachable stream is live.
 */
export async function verifyAuthorizedStream(params: {
  url: string;
  preferredPlatform?: StreamPlatform;
  customTitle?: string;
  gameName?: string;
  twitchClientId?: string;
  twitchAccessToken?: string;
  youtubeApiKey?: string;
  kickApiToken?: string;
}): Promise<PlatformCheckResult> {
  const canonicalUrl = normalizeStreamInput(
    params.url,
    params.preferredPlatform
  );
  const detected = detectPlatformFromUrl(canonicalUrl);
  const platform = detected.platform || params.preferredPlatform;

  if (!platform || platform === "demo" || platform === "upload") {
    throw new Error(
      "Enter a Twitch channel (twitch.tv/name), YouTube Live URL or @handle, Kick channel (kick.com/name), or direct .m3u8/.mp4 stream URL."
    );
  }

  const channel = detected.channelOrId || "channel";

  // 1. TWITCH — Keyless Public Live Resolver (+ live 720p HLS & anonymous IRC chat)
  if (platform === "twitch") {
    const info = await resolveTwitchLive(channel);
    const login = info.channelId || channel.toLowerCase();
    const descriptor =
      info.isLive && info.captureMode === "hls_ring"
        ? `twitch-live://${login}`
        : info.isLive
        ? `twitch-chat://${login}`
        : null;

    return {
      platform: "twitch",
      channelName: info.channelName,
      title: params.customTitle?.trim() || info.title,
      gameName: params.gameName?.trim() || info.gameName,
      status: info.isLive ? "ready" : info.errorState ? "error" : "offline",
      statusReason: info.statusReason,
      viewerCount: info.viewerCount,
      isLiveVerified: info.isLive,
      canonicalUrl: `https://www.twitch.tv/${login}`,
      sourceDescriptor: descriptor,
      previewImageUrl: info.thumbnailUrl,
    };
  }

  // 2. YOUTUBE LIVE — Keyless Public Live Resolver (+ live DVR/HLS & Live Chat)
  if (platform === "youtube") {
    const info = await resolveYoutubeLive(canonicalUrl);
    const descriptor =
      info.isLive && info.captureMode === "hls_ring" && info.hlsVariantUrl
        ? `youtube-hls://${info.channelId}`
        : info.isLive && info.captureMode === "youtube_dvr"
        ? `youtube-live://${info.channelId}`
        : info.isLive
        ? `youtube-chat://${info.channelId}`
        : null;

    const watchUrl = /^[a-zA-Z0-9_-]{11}$/.test(info.channelId)
      ? `https://www.youtube.com/watch?v=${info.channelId}`
      : canonicalUrl;

    return {
      platform: "youtube",
      channelName: info.channelName,
      title: params.customTitle?.trim() || info.title,
      gameName: params.gameName?.trim() || info.gameName,
      status: info.isLive ? "ready" : info.errorState ? "error" : "offline",
      statusReason: info.statusReason,
      viewerCount: info.viewerCount,
      isLiveVerified: info.isLive,
      canonicalUrl: watchUrl,
      sourceDescriptor: descriptor,
      previewImageUrl: info.thumbnailUrl,
    };
  }

  // 3. KICK — Keyless Public Channel + HLS + Pusher Chat (+ optional v1 token fallback)
  if (platform === "kick") {
    const info = await resolveKickLive(channel);
    const slug = info.channelId || channel.toLowerCase();

    // If Cloudflare blocked keyless check AND user optionally supplied a Kick OAuth token, try v1 API
    if (info.errorState && params.kickApiToken) {
      try {
        const res = await fetch(
          `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(
            slug
          )}`,
          {
            headers: {
              Authorization: `Bearer ${params.kickApiToken.replace(
                /^Bearer\s+/i,
                ""
              )}`,
            },
            signal: AbortSignal.timeout(8000),
          }
        );
        if (res.ok) {
          const data = (await res.json()) as {
            data?: Array<{
              slug?: string;
              stream_title?: string;
              category?: { name?: string };
              stream?: { is_live?: boolean; viewer_count?: number; thumbnail?: string };
            }>;
          };
          const ch = data.data?.[0];
          const live = Boolean(ch?.stream?.is_live);
          return {
            platform: "kick",
            channelName: ch?.slug || slug,
            title:
              params.customTitle?.trim() ||
              ch?.stream_title ||
              `${slug} on Kick`,
            gameName:
              params.gameName?.trim() || ch?.category?.name || "Gaming",
            status: live ? "ready" : "offline",
            statusReason: live
              ? "Verified LIVE on Kick."
              : `Verified on Kick: ${slug} is currently offline.`,
            viewerCount: Number(ch?.stream?.viewer_count || 0),
            isLiveVerified: live,
            canonicalUrl: `https://kick.com/${slug}`,
            sourceDescriptor: live ? `kick-live://${slug}` : null,
            previewImageUrl: ch?.stream?.thumbnail || null,
          };
        }
      } catch {
        // fall through to keyless result
      }
    }

    const q = new URLSearchParams();
    if (info.kickChatroomId) q.set("chatroom", String(info.kickChatroomId));
    if (info.hlsVariantUrl) q.set("hls", info.hlsVariantUrl);
    const qs = q.toString();
    const descriptor = info.isLive
      ? `kick-live://${slug}${qs ? `?${qs}` : ""}`
      : null;

    return {
      platform: "kick",
      channelName: info.channelName,
      title: params.customTitle?.trim() || info.title,
      gameName: params.gameName?.trim() || info.gameName,
      status: info.isLive ? "ready" : info.errorState ? "error" : "offline",
      statusReason: info.statusReason,
      viewerCount: info.viewerCount,
      isLiveVerified: info.isLive,
      canonicalUrl: `https://kick.com/${slug}`,
      sourceDescriptor: descriptor,
      previewImageUrl: info.thumbnailUrl,
    };
  }

  // 4. DIRECT HLS (.m3u8) OR MP4 STREAM — Zero API key!
  const isM3u8 = /\.m3u8(\?|$)/i.test(canonicalUrl);
  if (isM3u8) {
    try {
      const res = await fetch(canonicalUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!res.ok) {
        return {
          platform: "hls",
          channelName: channel,
          title: params.customTitle?.trim() || `HLS Stream (${channel})`,
          gameName: params.gameName?.trim() || "Live Gameplay",
          status: "error",
          statusReason: `HLS stream returned HTTP ${res.status} — verify the .m3u8 link is live and public.`,
          viewerCount: 0,
          isLiveVerified: false,
          canonicalUrl,
          sourceDescriptor: null,
          previewImageUrl: null,
        };
      }
      const txt = await res.text();
      const variant = selectBestHlsVariant(txt, canonicalUrl);
      if (!variant) {
        return {
          platform: "hls",
          channelName: channel,
          title: params.customTitle?.trim() || `HLS Stream (${channel})`,
          gameName: params.gameName?.trim() || "Live Gameplay",
          status: "offline",
          statusReason:
            "URL responded, but did not contain an active HLS video playlist (#EXTM3U).",
          viewerCount: 0,
          isLiveVerified: false,
          canonicalUrl,
          sourceDescriptor: null,
          previewImageUrl: null,
        };
      }
      return {
        platform: "hls",
        channelName: params.customTitle?.trim() || channel,
        title: params.customTitle?.trim() || `Live HLS Stream (${channel})`,
        gameName: params.gameName?.trim() || "Live Gameplay",
        status: "ready",
        statusReason:
          "Verified LIVE HLS playlist (no API key needed). Ready for 20s rolling segment buffer & FFmpeg MP4 capture.",
        viewerCount: 1,
        isLiveVerified: true,
        canonicalUrl,
        sourceDescriptor: variant,
        previewImageUrl: null,
      };
    } catch (err) {
      return {
        platform: "hls",
        channelName: channel,
        title: params.customTitle?.trim() || `HLS Stream (${channel})`,
        gameName: params.gameName?.trim() || "Gameplay",
        status: "error",
        statusReason: `Could not reach HLS stream: ${
          err instanceof Error ? err.message.slice(0, 120) : "network error"
        }`,
        viewerCount: 0,
        isLiveVerified: false,
        canonicalUrl,
        sourceDescriptor: null,
        previewImageUrl: null,
      };
    }
  }

  // Direct .mp4 URL via FFprobe
  try {
    const info = await probeMedia(canonicalUrl);
    return {
      platform: "hls",
      channelName: params.customTitle?.trim() || channel,
      title: params.customTitle?.trim() || `Direct Video Feed (${channel})`,
      gameName: params.gameName?.trim() || "Live Gameplay",
      status: "ready",
      statusReason: `Verified playable video stream (${info.width}x${info.height} ${info.videoCodec.toUpperCase()} @ ${info.fps}fps · No API key needed).`,
      viewerCount: 1,
      isLiveVerified: true,
      canonicalUrl,
      sourceDescriptor: canonicalUrl,
      previewImageUrl: null,
    };
  } catch (err) {
    return {
      platform: "hls",
      channelName: channel,
      title: params.customTitle?.trim() || `Stream (${channel})`,
      gameName: params.gameName?.trim() || "Gameplay",
      status: "error",
      statusReason: `Stream probe failed — stream is unreachable or offline (${
        err instanceof Error ? err.message.slice(0, 120) : "probe error"
      }).`,
      viewerCount: 0,
      isLiveVerified: false,
      canonicalUrl,
      sourceDescriptor: null,
      previewImageUrl: null,
    };
  }
}
