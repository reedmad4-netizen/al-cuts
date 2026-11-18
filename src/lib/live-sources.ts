/**
 * Zero-API-Key Public Live Stream Resolver & Rolling 20-Second Capture Engine
 * Supports: Twitch, YouTube Live, Kick, and direct HLS (.m3u8) / MP4 streams
 * Works out of the box on Windows, macOS, and Linux (Node 18–26+) with zero
 * API keys, zero Python/yt-dlp, and zero native C++ build dependencies.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractThumbnail,
  getFfmpegBin,
  getQualitySpec,
  probeMedia,
} from "./ffmpeg";
import type { DiscoveredLiveStream, VideoQuality } from "./types";

const TWITCH_PUBLIC_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const YT_IOS_VERSION = "21.02.3";
const YT_IOS_UA = `com.google.ios.youtube/${YT_IOS_VERSION} (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)`;

export interface ResolvedLiveSource {
  platform: "twitch" | "youtube" | "kick" | "hls";
  isLive: boolean;
  channelId: string; // twitch login, youtube videoId, kick slug, or hls slug
  channelName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string | null;
  statusReason: string;
  errorState?: boolean;
  // Video capture transport
  captureMode: "hls_ring" | "youtube_dvr" | "direct_media" | "none";
  hlsVariantUrl?: string;
  kickChatroomId?: number;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Picks the highest-quality H.264 stream variant matching `quality`:
 * - `1080p_source` / `1080p_high` (default): prefers 1080p60 (source, highest fps & bitrate),
 *   then 1440p60 / highest H.264 available (e.g. 720p60 if broadcaster streams at 720p).
 * - `720p_balanced`: prefers highest-fps, highest-bitrate 720p60 variant.
 */
export function selectBestHlsVariant(
  masterText: string,
  masterUrl: string,
  quality: VideoQuality = "1080p_source"
): string | null {
  const lines = masterText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // If this is already a media playlist (contains #EXTINF), return masterUrl directly
  if (lines.some((l) => l.startsWith("#EXTINF:"))) {
    return masterUrl;
  }

  interface Candidate {
    url: string;
    height: number;
    bandwidth: number;
    frameRate: number;
    isH264: boolean;
    audioOnly: boolean;
  }
  const candidates: Candidate[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const next = lines[i + 1];
    if (!next || next.startsWith("#")) continue;

    const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const fpsMatch = line.match(/FRAME-RATE=(\d+(?:\.\d+)?)/i);
    const codecMatch = line.match(/CODECS="([^"]+)"/i);
    const height = resMatch ? Number(resMatch[2]) : 0;
    const bandwidth = bwMatch ? Number(bwMatch[1]) : 0;
    const frameRate = fpsMatch ? Number(fpsMatch[1]) : 30;
    const codecStr = codecMatch?.[1] || "";
    const isH264 = !codecStr || /avc1/i.test(codecStr);
    const audioOnly =
      /audio_only/i.test(line) || (height === 0 && bandwidth < 250_000);

    try {
      candidates.push({
        url: new URL(next, masterUrl).href,
        height,
        bandwidth,
        frameRate,
        isH264,
        audioOnly,
      });
    } catch {
      // skip invalid url
    }
  }

  const allVideo = candidates.filter((c) => !c.audioOnly);
  if (allVideo.length === 0) return null;

  // Prefer H.264 (avc1) for universal browser/mobile/editor MP4 compatibility & lossless copy
  const h264Pool = allVideo.filter((c) => c.isH264);
  const pool = h264Pool.length > 0 ? h264Pool : allVideo;

  const rankBest = (a: Candidate, b: Candidate) =>
    b.height - a.height ||
    b.frameRate - a.frameRate ||
    b.bandwidth - a.bandwidth;

  if (quality === "720p_balanced") {
    const p720 = pool
      .filter((c) => c.height >= 680 && c.height <= 760)
      .sort((a, b) => b.frameRate - a.frameRate || b.bandwidth - a.bandwidth);
    if (p720[0]) return p720[0].url;

    const sub720 = pool.filter((c) => c.height > 0 && c.height <= 760).sort(rankBest);
    if (sub720[0]) return sub720[0].url;
  }

  // Default (1080p_source / 1080p_high): pick crispest 1080p60 (source) first!
  const p1080 = pool
    .filter((c) => c.height >= 960 && c.height <= 1120)
    .sort((a, b) => b.frameRate - a.frameRate || b.bandwidth - a.bandwidth);
  if (p1080[0]) return p1080[0].url;

  // Otherwise pick the highest resolution + fps + bitrate stream available (e.g. 720p60 or 1440p60)
  const bestUpTo1440 = pool
    .filter((c) => c.height > 0 && c.height <= 1440)
    .sort(rankBest);
  if (bestUpTo1440[0]) return bestUpTo1440[0].url;

  pool.sort((a, b) => b.bandwidth - a.bandwidth);
  return pool[0].url;
}

// ---------------------------------------------------------------------------
// 1. TWITCH — Keyless Live Status, Metadata, HLS Variant & Live Discovery
// ---------------------------------------------------------------------------

export async function fetchTwitchHlsVariant(
  login: string,
  quality: VideoQuality = "1080p_source"
): Promise<string | null> {
  const cleanLogin = login.trim().toLowerCase();
  if (!cleanLogin) return null;

  const tokRes = await fetch("https://gql.twitch.tv/gql", {
    method: "POST",
    headers: {
      "Client-Id": TWITCH_PUBLIC_CLIENT_ID,
      "Content-Type": "application/json",
      "User-Agent": WEB_UA,
    },
    body: JSON.stringify({
      operationName: "PlaybackAccessToken_Template",
      query:
        'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature authorization { isForbidden forbiddenReasonCode } __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }',
      variables: {
        isLive: true,
        login: cleanLogin,
        isVod: false,
        vodID: "",
        playerType: "popout",
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!tokRes.ok) return null;

  const tokJson = (await tokRes.json()) as {
    data?: {
      streamPlaybackAccessToken?: {
        value?: string;
        signature?: string;
        authorization?: { isForbidden?: boolean };
      };
    };
  };
  const pat = tokJson.data?.streamPlaybackAccessToken;
  if (!pat?.value || !pat?.signature || pat.authorization?.isForbidden) {
    return null;
  }

  const masterUrl =
    `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(
      cleanLogin
    )}.m3u8` +
    `?client_id=${TWITCH_PUBLIC_CLIENT_ID}` +
    `&token=${encodeURIComponent(pat.value)}` +
    `&sig=${encodeURIComponent(pat.signature)}` +
    `&allow_source=true&allow_audio_only=true&fast_bread=true` +
    `&p=${Math.floor(Math.random() * 9_999_999)}`;

  const masterRes = await fetch(masterUrl, {
    headers: { "User-Agent": WEB_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!masterRes.ok) return null;
  const masterText = await masterRes.text();
  return selectBestHlsVariant(masterText, masterUrl, quality);
}

export async function resolveTwitchLive(
  rawChannel: string
): Promise<ResolvedLiveSource> {
  const login = rawChannel
    .trim()
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();

  if (!login) {
    return {
      platform: "twitch",
      isLive: false,
      channelId: "",
      channelName: "unknown",
      title: "Invalid Twitch channel",
      gameName: "Offline",
      viewerCount: 0,
      thumbnailUrl: null,
      statusReason: "Enter a valid Twitch URL like https://www.twitch.tv/shroud",
      errorState: true,
      captureMode: "none",
    };
  }

  try {
    const res = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-Id": TWITCH_PUBLIC_CLIENT_ID,
        "Content-Type": "application/json",
        "User-Agent": WEB_UA,
      },
      body: JSON.stringify({
        query: `query($login: String!) {
          user(login: $login) {
            login
            displayName
            broadcastSettings { title game { name } }
            stream {
              id
              title
              type
              viewersCount
              previewImageURL(width: 640, height: 360)
              game { name }
            }
          }
        }`,
        variables: { login },
      }),
      signal: AbortSignal.timeout(9000),
    });

    if (!res.ok) {
      return {
        platform: "twitch",
        isLive: false,
        channelId: login,
        channelName: login,
        title: `${login} on Twitch`,
        gameName: "Twitch",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Twitch returned HTTP ${res.status}. Try again in a moment.`,
        errorState: true,
        captureMode: "none",
      };
    }

    const json = (await res.json()) as {
      data?: {
        user?: {
          login?: string;
          displayName?: string;
          broadcastSettings?: { title?: string; game?: { name?: string } };
          stream?: {
            id?: string;
            title?: string;
            type?: string;
            viewersCount?: number;
            previewImageURL?: string;
            game?: { name?: string };
          } | null;
        } | null;
      };
    };

    const user = json.data?.user;
    if (!user) {
      return {
        platform: "twitch",
        isLive: false,
        channelId: login,
        channelName: login,
        title: `${login} (Channel Not Found)`,
        gameName: "Offline",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Twitch channel "${login}" does not exist.`,
        captureMode: "none",
      };
    }

    const stream = user.stream;
    const displayName = user.displayName || user.login || login;

    if (!stream || stream.type !== "live") {
      return {
        platform: "twitch",
        isLive: false,
        channelId: login,
        channelName: displayName,
        title:
          user.broadcastSettings?.title || `${displayName} (Currently Offline)`,
        gameName: user.broadcastSettings?.game?.name || "Offline",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Verified on Twitch (no API key needed): ${displayName} is currently offline. Click Re-check when they go live.`,
        captureMode: "none",
      };
    }

    const hlsVariant = await fetchTwitchHlsVariant(login);
    const title =
      stream.title ||
      user.broadcastSettings?.title ||
      `${displayName} Live on Twitch`;
    const gameName =
      stream.game?.name || user.broadcastSettings?.game?.name || "Gaming";
    const viewers = Number(stream.viewersCount || 0);
    const thumb =
      stream.previewImageURL ||
      `https://static-cdn.jtvnw.net/previews-ttv/live_user_${login}-640x360.jpg`;

    if (!hlsVariant) {
      return {
        platform: "twitch",
        isLive: true,
        channelId: login,
        channelName: displayName,
        title,
        gameName,
        viewerCount: viewers,
        thumbnailUrl: thumb,
        statusReason: `LIVE on Twitch (${viewers.toLocaleString()} viewers), but video stream is subscriber-only or geo-restricted. Live chat monitoring is still available.`,
        captureMode: "none",
      };
    }

    return {
      platform: "twitch",
      isLive: true,
      channelId: login,
      channelName: displayName,
      title,
      gameName,
      viewerCount: viewers,
      thumbnailUrl: thumb,
      statusReason: `Verified LIVE on Twitch (${viewers.toLocaleString()} viewers · No API key required). Ready for live 20s HLS rolling buffer + real-time Twitch chat spike clipping.`,
      captureMode: "hls_ring",
      hlsVariantUrl: hlsVariant,
    };
  } catch (err) {
    return {
      platform: "twitch",
      isLive: false,
      channelId: login,
      channelName: login,
      title: `${login} on Twitch`,
      gameName: "Twitch",
      viewerCount: 0,
      thumbnailUrl: null,
      statusReason: `Could not reach Twitch: ${
        err instanceof Error ? err.message : "network error"
      }`,
      errorState: true,
      captureMode: "none",
    };
  }
}

// ---------------------------------------------------------------------------
// 2. YOUTUBE LIVE — Keyless Live Status, Metadata, Live DVR & HLS Capture
// ---------------------------------------------------------------------------

function extractBalancedJson(
  source: string,
  marker: string
): Record<string, unknown> | null {
  const mIdx = source.indexOf(marker);
  if (mIdx === -1) return null;
  const start = source.indexOf("{", mIdx);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as Record<
            string,
            unknown
          >;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function buildYoutubePageUrl(rawUrlOrId: string): string {
  const trimmed = rawUrlOrId.trim();
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);

    if (host === "youtu.be" && parts[0]) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(parts[0])}`;
    }
    const v = u.searchParams.get("v");
    if (v) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(v)}`;
    }
    if (parts[0] === "live" && parts[1]) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(parts[1])}`;
    }
    if (parts[0]?.startsWith("@")) {
      return `https://www.youtube.com/${parts[0]}/live`;
    }
    if (
      (parts[0] === "channel" || parts[0] === "c" || parts[0] === "user") &&
      parts[1]
    ) {
      return `https://www.youtube.com/${parts[0]}/${parts[1]}/live`;
    }
    return trimmed;
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
      return `https://www.youtube.com/watch?v=${trimmed}`;
    }
    const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    return `https://www.youtube.com/${handle}/live`;
  }
}

interface YoutubeIosFormats {
  videoUrl: string;
  audioUrl: string | null;
  targetDurationSec: number;
  width: number;
  height: number;
  hlsManifestUrl: string | null;
}

export async function fetchYoutubeIosLiveFormats(
  videoId: string,
  quality: VideoQuality = "1080p_source"
): Promise<YoutubeIosFormats | null> {
  const res = await fetch(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": YT_IOS_UA,
        "X-YouTube-Client-Name": "5",
        "X-YouTube-Client-Version": YT_IOS_VERSION,
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "IOS",
            clientVersion: YT_IOS_VERSION,
            deviceMake: "Apple",
            deviceModel: "iPhone16,2",
            osName: "iPhone",
            osVersion: "18.3.2.22D82",
            hl: "en",
            gl: "US",
          },
        },
      }),
      signal: AbortSignal.timeout(9000),
    }
  );
  if (!res.ok) return null;

  const json = (await res.json()) as {
    playabilityStatus?: { status?: string };
    videoDetails?: { isLive?: boolean };
    streamingData?: {
      hlsManifestUrl?: string;
      adaptiveFormats?: Array<{
        itag?: number;
        url?: string;
        mimeType?: string;
        width?: number;
        height?: number;
        bitrate?: number;
        targetDurationSec?: number;
      }>;
    };
  };

  if (json.playabilityStatus?.status !== "OK" || !json.videoDetails?.isLive) {
    return null;
  }

  const hlsManifestUrl = json.streamingData?.hlsManifestUrl || null;
  const afs = (json.streamingData?.adaptiveFormats || []).filter((f) =>
    Boolean(f.url)
  );

  // Pick highest-quality H.264 1080p60 / 1080p (or 720p60 when 720p_balanced) + high-bitrate AAC stereo
  const maxHeight = quality === "720p_balanced" ? 720 : 1080;
  const mp4Videos = afs
    .filter((f) => f.mimeType?.startsWith("video/mp4"))
    .sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (b.bitrate || 0) - (a.bitrate || 0)
    );
  const chosenVideo =
    mp4Videos.find((f) => (f.height || 0) <= maxHeight && (f.height || 0) >= 720) ||
    mp4Videos.find((f) => (f.height || 0) <= maxHeight) ||
    mp4Videos[0] ||
    afs
      .filter((f) => f.mimeType?.startsWith("video/") && (f.height || 0) <= maxHeight)
      .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0))[0];

  const chosenAudio =
    afs
      .filter((f) => f.mimeType?.startsWith("audio/mp4"))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0] ||
    afs.find((f) => f.itag === 140) ||
    afs.find((f) => f.mimeType?.startsWith("audio/")) ||
    null;

  if (!chosenVideo?.url) {
    if (hlsManifestUrl) {
      return {
        videoUrl: "",
        audioUrl: null,
        targetDurationSec: 5,
        width: 1280,
        height: 720,
        hlsManifestUrl,
      };
    }
    return null;
  }

  return {
    videoUrl: chosenVideo.url,
    audioUrl: chosenAudio?.url || null,
    targetDurationSec: Math.max(1, Number(chosenVideo.targetDurationSec || 5)),
    width: Number(chosenVideo.width || 1280),
    height: Number(chosenVideo.height || 720),
    hlsManifestUrl,
  };
}

export async function resolveYoutubeLive(
  rawUrlOrId: string,
  quality: VideoQuality = "1080p_source"
): Promise<ResolvedLiveSource> {
  const pageUrl = buildYoutubePageUrl(rawUrlOrId);

  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent": WEB_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+667",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return {
        platform: "youtube",
        isLive: false,
        channelId: rawUrlOrId,
        channelName: rawUrlOrId,
        title: `YouTube (${rawUrlOrId})`,
        gameName: "YouTube Gaming",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `YouTube returned HTTP ${res.status}. Check the stream or channel URL.`,
        errorState: true,
        captureMode: "none",
      };
    }

    const html = await res.text();
    const pr = extractBalancedJson(html, "var ytInitialPlayerResponse") as {
      playabilityStatus?: { status?: string; reason?: string };
      videoDetails?: {
        videoId?: string;
        title?: string;
        author?: string;
        viewCount?: string;
        isLive?: boolean;
        isLiveContent?: boolean;
      };
      microformat?: {
        playerMicroformatRenderer?: {
          category?: string;
          liveBroadcastDetails?: { isLiveNow?: boolean };
        };
      };
      streamingData?: {
        hlsManifestUrl?: string;
      };
    } | null;

    const vd = pr?.videoDetails;
    const isLiveNow = Boolean(
      vd?.isLive ||
        pr?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails
          ?.isLiveNow
    );

    if (!vd?.videoId || !isLiveNow) {
      const chName =
        vd?.author ||
        html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ||
        rawUrlOrId;
      const reason = vd?.title
        ? `Verified on YouTube (no API key needed): "${vd.title}" is not currently live (VOD or ended stream).`
        : `Verified on YouTube (no API key needed): ${chName} is not currently live.`;
      return {
        platform: "youtube",
        isLive: false,
        channelId: vd?.videoId || rawUrlOrId,
        channelName: chName,
        title: vd?.title || `${chName} (Currently Offline)`,
        gameName: "Offline",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: reason,
        captureMode: "none",
      };
    }

    const videoId = vd.videoId;
    const title = vd.title || "YouTube Live Stream";
    const channelName = vd.author || "YouTube Creator";
    const category =
      pr?.microformat?.playerMicroformatRenderer?.category || "YouTube Gaming";
    // Extract real concurrent viewer count from watch page if shown
    const liveViewMatch = html.match(
      /"viewCount":\{"videoViewCountRenderer":\{[\s\S]{0,250}?"runs":\[\{"text":"([\d,]+)"\},\{"text":"\s*watching/i
    );
    const viewerCount = liveViewMatch
      ? Number(liveViewMatch[1].replace(/,/g, "")) || 0
      : Number(vd.viewCount || 0);
    const thumb = `https://i.ytimg.com/vi/${videoId}/hqdefault_live.jpg`;

    // Check direct HLS manifest or keyless live DVR segment stream
    const iosFormats = await fetchYoutubeIosLiveFormats(videoId, quality);
    const hlsMaster =
      pr?.streamingData?.hlsManifestUrl || iosFormats?.hlsManifestUrl || null;

    if (hlsMaster) {
      try {
        const mRes = await fetch(hlsMaster, {
          headers: { "User-Agent": WEB_UA },
          signal: AbortSignal.timeout(7000),
        });
        if (mRes.ok) {
          const variant = selectBestHlsVariant(
            await mRes.text(),
            hlsMaster,
            quality
          );
          if (variant) {
            return {
              platform: "youtube",
              isLive: true,
              channelId: videoId,
              channelName,
              title,
              gameName: category,
              viewerCount,
              thumbnailUrl: thumb,
              statusReason: `Verified LIVE on YouTube (no API key required). Ready for live 20s rolling buffer + real-time YouTube Live Chat monitoring.`,
              captureMode: "hls_ring",
              hlsVariantUrl: variant,
            };
          }
        }
      } catch {
        // fall through to youtube_dvr
      }
    }

    if (iosFormats?.videoUrl) {
      return {
        platform: "youtube",
        isLive: true,
        channelId: videoId,
        channelName,
        title,
        gameName: category,
        viewerCount,
        thumbnailUrl: thumb,
        statusReason: `Verified LIVE on YouTube (${iosFormats.height}p · No API key required). Ready for live 20s DVR rolling buffer + real-time YouTube Live Chat spike clipping.`,
        captureMode: "youtube_dvr",
      };
    }

    return {
      platform: "youtube",
      isLive: true,
      channelId: videoId,
      channelName,
      title,
      gameName: category,
      viewerCount,
      thumbnailUrl: thumb,
      statusReason: `LIVE on YouTube, but stream restricts direct segment playback (members-only or age-gated). Live chat monitoring is still active.`,
      captureMode: "none",
    };
  } catch (err) {
    return {
      platform: "youtube",
      isLive: false,
      channelId: rawUrlOrId,
      channelName: rawUrlOrId,
      title: `YouTube (${rawUrlOrId})`,
      gameName: "YouTube Gaming",
      viewerCount: 0,
      thumbnailUrl: null,
      statusReason: `Could not reach YouTube: ${
        err instanceof Error ? err.message : "network error"
      }`,
      errorState: true,
      captureMode: "none",
    };
  }
}

/**
 * Captures the exact previous `preBufferSec` (20s) + post-event `postBufferSec`
 * directly from an active YouTube Live stream's live DVR fMP4 sequence window.
 */
export async function captureYoutubeLiveDvrClip(params: {
  videoId: string;
  preBufferSec: number;
  postBufferSec: number;
  outputMp4Path: string;
  outputPosterPath: string;
  quality?: VideoQuality;
  onProgress?: (pct: number) => void;
}): Promise<{
  durationSeconds: number;
  actualPreBufferSec: number;
  actualPostBufferSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
}> {
  const quality: VideoQuality = params.quality ?? "1080p_source";
  const qSpec = getQualitySpec(quality);
  const formats = await fetchYoutubeIosLiveFormats(params.videoId, quality);
  if (!formats || (!formats.videoUrl && !formats.hlsManifestUrl)) {
    throw new Error(
      "YouTube live stream is no longer live or restricts unauthenticated video playback."
    );
  }

  // Probe live head sequence number at the moment of the event
  const headProbe = await fetch(`${formats.videoUrl}&sq=0`, {
    headers: { "User-Agent": YT_IOS_UA },
    signal: AbortSignal.timeout(10000),
  });
  // Drain small body cleanly
  await headProbe.arrayBuffer().catch(() => null);

  const eventHeadSeq = Number(headProbe.headers.get("x-head-seqnum") || 0);
  if (!eventHeadSeq || eventHeadSeq < 2) {
    throw new Error(
      "Could not read live DVR sequence from this YouTube broadcast (DVR may be disabled by the streamer)."
    );
  }

  const segDur = Math.max(1, formats.targetDurationSec || 5);
  const preSegCount = Math.max(2, Math.ceil(params.preBufferSec / segDur));
  const postSegCount = Math.max(1, Math.ceil(params.postBufferSec / segDur));
  const startSeq = Math.max(1, eventHeadSeq - preSegCount);

  params.onProgress?.(15);

  // Download pre-buffer segments (previous ~20s) immediately while post-event plays out live!
  const vChunks: Buffer[] = [];
  const aChunks: Buffer[] = [];

  const downloadSeq = async (sq: number): Promise<boolean> => {
    try {
      const [vr, ar] = await Promise.all([
        fetch(`${formats.videoUrl}&sq=${sq}`, {
          headers: { "User-Agent": YT_IOS_UA },
          signal: AbortSignal.timeout(12000),
        }),
        formats.audioUrl
          ? fetch(`${formats.audioUrl}&sq=${sq}`, {
              headers: { "User-Agent": YT_IOS_UA },
              signal: AbortSignal.timeout(12000),
            })
          : Promise.resolve(null),
      ]);
      if (!vr.ok) return false;
      const vb = Buffer.from(await vr.arrayBuffer());
      if (vb.length < 512) return false;
      vChunks.push(vb);
      if (ar?.ok) {
        const ab = Buffer.from(await ar.arrayBuffer());
        if (ab.length > 128) aChunks.push(ab);
      }
      return true;
    } catch {
      return false;
    }
  };

  for (let sq = startSeq; sq < eventHeadSeq; sq++) {
    await downloadSeq(sq);
  }
  const capturedPreSec = vChunks.length * segDur;
  params.onProgress?.(45);

  // Wait full requested post-event duration (up to 45s so full 60s Shorts capture end-to-end)
  const targetPostWaitMs = Math.min(45_000, params.postBufferSec * 980);
  await sleep(targetPostWaitMs);

  // Check updated live head sequence and pull available post-event segments
  const afterProbe = await fetch(`${formats.videoUrl}&sq=0`, {
    headers: { "User-Agent": YT_IOS_UA },
    signal: AbortSignal.timeout(8000),
  });
  await afterProbe.arrayBuffer().catch(() => null);
  const latestHead = Number(
    afterProbe.headers.get("x-head-seqnum") || eventHeadSeq
  );
  const endSeq = Math.min(latestHead, eventHeadSeq + postSegCount);

  for (let sq = eventHeadSeq; sq < endSeq; sq++) {
    await downloadSeq(sq);
  }

  if (vChunks.length === 0) {
    throw new Error("Failed to download live video segments from YouTube.");
  }

  params.onProgress?.(68);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipx-ytlive-"));
  try {
    fs.mkdirSync(path.dirname(params.outputMp4Path), { recursive: true });
    fs.mkdirSync(path.dirname(params.outputPosterPath), { recursive: true });

    const vPath = path.join(tmpDir, "video.mp4");
    const aPath = path.join(tmpDir, "audio.m4a");
    fs.writeFileSync(vPath, Buffer.concat(vChunks));
    const hasAudio = aChunks.length > 0;
    if (hasAudio) fs.writeFileSync(aPath, Buffer.concat(aChunks));

    // Try lossless 1080p60/HD stream-copy remux first (zero quality loss!), then Full HD High Profile fallback
    let remuxOk = false;
    if (qSpec.allowLosslessCopy) {
      try {
        await runFfmpegSimple([
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          vPath,
          ...(hasAudio ? ["-i", aPath] : []),
          "-c:v",
          "copy",
          ...(hasAudio ? ["-c:a", "copy", "-shortest"] : ["-an"]),
          "-movflags",
          "+faststart",
          path.resolve(params.outputMp4Path),
        ]);
        const check = await probeMedia(params.outputMp4Path);
        if (check.durationSeconds >= 3 && check.width >= 320) {
          remuxOk = true;
        }
      } catch {
        remuxOk = false;
      }
    }

    if (!remuxOk) {
      await runFfmpegSimple([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        vPath,
        ...(hasAudio ? ["-i", aPath] : []),
        "-vf",
        `scale='min(${qSpec.landscapeW},iw)':-2:flags=lanczos,format=yuv420p`,
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-preset",
        qSpec.preset,
        "-crf",
        qSpec.crf,
        "-maxrate",
        qSpec.maxrate,
        "-bufsize",
        qSpec.bufsize,
        ...(hasAudio
          ? ["-c:a", "aac", "-b:a", qSpec.audioBitrate, "-ar", "48000", "-shortest"]
          : ["-an"]),
        "-movflags",
        "+faststart",
        path.resolve(params.outputMp4Path),
      ]);
    }
    params.onProgress?.(94);

    const info = await probeMedia(params.outputMp4Path);
    const actualPre = Number(
      Math.min(
        params.preBufferSec,
        Math.min(info.durationSeconds, capturedPreSec)
      ).toFixed(1)
    );
    const actualPost = Number(
      Math.max(0, info.durationSeconds - actualPre).toFixed(1)
    );

    await extractThumbnail(
      params.outputMp4Path,
      params.outputPosterPath,
      Math.min(Math.max(0.5, info.durationSeconds - 0.5), actualPre)
    );
    params.onProgress?.(100);

    return {
      durationSeconds: info.durationSeconds,
      actualPreBufferSec: actualPre,
      actualPostBufferSec: actualPost,
      width: info.width,
      height: info.height,
      fileSizeBytes: info.fileSizeBytes,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. KICK — Keyless Public v2 Channel + HLS Resolver (Works on Home Networks)
// ---------------------------------------------------------------------------

export async function resolveKickLive(
  rawChannel: string,
  quality: VideoQuality = "1080p_source"
): Promise<ResolvedLiveSource> {
  const slug = rawChannel
    .trim()
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .toLowerCase();

  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      {
        headers: {
          "User-Agent": WEB_UA,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(9000),
      }
    );

    if (res.status === 404) {
      return {
        platform: "kick",
        isLive: false,
        channelId: slug,
        channelName: slug,
        title: `${slug} (Channel Not Found)`,
        gameName: "Offline",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Kick channel "${slug}" was not found.`,
        captureMode: "none",
      };
    }

    if (res.status === 403) {
      return {
        platform: "kick",
        isLive: false,
        channelId: slug,
        channelName: slug,
        title: `${slug} on Kick`,
        gameName: "Kick",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Kick's Cloudflare shield blocked automated lookup on this network. Tip: open https://kick.com/api/v2/channels/${slug} in your browser, copy "playback_url" (.m3u8), and paste it directly above — no API key needed!`,
        errorState: true,
        captureMode: "none",
      };
    }

    if (!res.ok) {
      return {
        platform: "kick",
        isLive: false,
        channelId: slug,
        channelName: slug,
        title: `${slug} on Kick`,
        gameName: "Kick",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Kick returned HTTP ${res.status}.`,
        errorState: true,
        captureMode: "none",
      };
    }

    const kj = (await res.json()) as {
      slug?: string;
      user?: { username?: string };
      playback_url?: string;
      chatroom?: { id?: number };
      livestream?: {
        is_live?: boolean;
        session_title?: string;
        viewer_count?: number;
        thumbnail?: { url?: string };
        categories?: Array<{ name?: string }>;
      } | null;
    };

    const displayName = kj.user?.username || kj.slug || slug;
    const ls = kj.livestream;
    if (!ls || !ls.is_live) {
      return {
        platform: "kick",
        isLive: false,
        channelId: slug,
        channelName: displayName,
        title: `${displayName} (Currently Offline)`,
        gameName: "Offline",
        viewerCount: 0,
        thumbnailUrl: null,
        statusReason: `Verified on Kick (no API key needed): ${displayName} is currently offline.`,
        captureMode: "none",
      };
    }

    let variant: string | null = kj.playback_url || null;
    if (variant) {
      try {
        const mr = await fetch(variant, {
          headers: { "User-Agent": WEB_UA },
          signal: AbortSignal.timeout(7000),
        });
        if (mr.ok) {
          variant =
            selectBestHlsVariant(await mr.text(), variant, quality) || variant;
        }
      } catch {
        // keep master playback_url
      }
    }

    const viewers = Number(ls.viewer_count || 0);
    return {
      platform: "kick",
      isLive: true,
      channelId: slug,
      channelName: displayName,
      title: ls.session_title || `${displayName} Live on Kick`,
      gameName: ls.categories?.[0]?.name || "Gaming",
      viewerCount: viewers,
      thumbnailUrl: ls.thumbnail?.url || null,
      statusReason: `Verified LIVE on Kick (${viewers.toLocaleString()} viewers · No API key required). Ready for live 20s HLS rolling buffer + real-time Kick chat monitoring.`,
      captureMode: variant ? "hls_ring" : "none",
      hlsVariantUrl: variant || undefined,
      kickChatroomId: kj.chatroom?.id,
    };
  } catch (err) {
    return {
      platform: "kick",
      isLive: false,
      channelId: slug,
      channelName: slug,
      title: `${slug} on Kick`,
      gameName: "Kick",
      viewerCount: 0,
      thumbnailUrl: null,
      statusReason: `Could not reach Kick: ${
        err instanceof Error ? err.message : "network error"
      }`,
      errorState: true,
      captureMode: "none",
    };
  }
}

// ---------------------------------------------------------------------------
// 4. KEYLESS LIVE GAMING STREAM DISCOVERY (Twitch + YouTube Live)
// ---------------------------------------------------------------------------

export async function discoverLiveGamingStreams(
  query = ""
): Promise<DiscoveredLiveStream[]> {
  const results: DiscoveredLiveStream[] = [];
  const trimmed = query.trim();

  // Fetch Twitch + YouTube live gaming streams in parallel (0 API keys!)
  const twitchTask = (async () => {
    try {
      const gqlBody = trimmed
        ? {
            query: `query($slug: String!) {
              game(name: $slug) {
                name
                streams(first: 6) {
                  edges {
                    node {
                      broadcaster { login displayName }
                      title
                      viewersCount
                      type
                      previewImageURL(width: 440, height: 248)
                      game { name }
                    }
                  }
                }
              }
            }`,
            variables: { slug: trimmed },
          }
        : {
            query: `query {
              streams(first: 8) {
                edges {
                  node {
                    broadcaster { login displayName }
                    title
                    viewersCount
                    type
                    previewImageURL(width: 440, height: 248)
                    game { name }
                  }
                }
              }
            }`,
          };

      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: {
          "Client-Id": TWITCH_PUBLIC_CLIENT_ID,
          "Content-Type": "application/json",
          "User-Agent": WEB_UA,
        },
        body: JSON.stringify(gqlBody),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        data?: {
          game?: { streams?: { edges?: Array<{ node?: Record<string, unknown> }> } };
          streams?: { edges?: Array<{ node?: Record<string, unknown> }> };
        };
      };
      const edges =
        json.data?.game?.streams?.edges || json.data?.streams?.edges || [];

      for (const edge of edges) {
        const n = edge.node as {
          broadcaster?: { login?: string; displayName?: string };
          title?: string;
          viewersCount?: number;
          type?: string;
          previewImageURL?: string;
          game?: { name?: string };
        };
        if (!n?.broadcaster?.login || n.type !== "live") continue;
        const gameName = n.game?.name || "Gaming";
        // Skip non-gaming Just Chatting on default browse if plenty of gaming results exist
        if (!trimmed && gameName === "Just Chatting" && results.length >= 4) {
          continue;
        }
        results.push({
          platform: "twitch",
          channelId: n.broadcaster.login,
          channelName: n.broadcaster.displayName || n.broadcaster.login,
          title: n.title || `${n.broadcaster.displayName} Live`,
          gameName,
          viewerCount: Number(n.viewersCount || 0),
          thumbnailUrl:
            n.previewImageURL ||
            `https://static-cdn.jtvnw.net/previews-ttv/live_user_${n.broadcaster.login}-440x248.jpg`,
          streamUrl: `https://www.twitch.tv/${n.broadcaster.login}`,
        });
      }
    } catch {
      // non-fatal
    }
  })();

  const youtubeTask = (async () => {
    try {
      const searchTerm = trimmed ? `${trimmed} gameplay live` : "valorant cs2 gaming live";
      // sp=EgJAAQ%3D%3D filters YouTube search strictly to currently LIVE streams!
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
        searchTerm
      )}&sp=EgJAAQ%253D%253D`;
      const res = await fetch(ytUrl, {
        headers: {
          "User-Agent": WEB_UA,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+667",
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) return;
      const html = await res.text();
      const data = extractBalancedJson(html, "var ytInitialData") as {
        contents?: {
          twoColumnSearchResultsRenderer?: {
            primaryContents?: {
              sectionListRenderer?: {
                contents?: Array<{
                  itemSectionRenderer?: {
                    contents?: Array<{
                      videoRenderer?: {
                        videoId?: string;
                        title?: { runs?: Array<{ text?: string }> };
                        ownerText?: { runs?: Array<{ text?: string }> };
                        viewCountText?: { runs?: Array<{ text?: string }> };
                        badges?: Array<{
                          metadataBadgeRenderer?: { style?: string };
                        }>;
                      };
                    }>;
                  };
                }>;
              };
            };
          };
        };
      } | null;

      const sections =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
          ?.sectionListRenderer?.contents || [];
      let added = 0;
      for (const sec of sections) {
        const items = sec.itemSectionRenderer?.contents || [];
        for (const it of items) {
          const vr = it.videoRenderer;
          if (!vr?.videoId || added >= 4) continue;
          const title = (vr.title?.runs || []).map((r) => r.text || "").join("");
          const author =
            vr.ownerText?.runs?.[0]?.text || "YouTube Gaming";
          const viewTxt = vr.viewCountText?.runs?.[0]?.text || "0";
          const viewers = Number(viewTxt.replace(/[^\d]/g, "")) || 0;
          results.push({
            platform: "youtube",
            channelId: vr.videoId,
            channelName: author,
            title: title || `${author} Live`,
            gameName: trimmed || "YouTube Gaming",
            viewerCount: viewers,
            thumbnailUrl: `https://i.ytimg.com/vi/${vr.videoId}/hqdefault_live.jpg`,
            streamUrl: `https://www.youtube.com/watch?v=${vr.videoId}`,
          });
          added++;
        }
      }
    } catch {
      // non-fatal
    }
  })();

  await Promise.all([twitchTask, youtubeTask]);
  return results.slice(0, 10);
}

// ---------------------------------------------------------------------------
// 5. CONTINUOUS ROLLING 20-SECOND HLS SEGMENT RING BUFFER (Pure Node + FFmpeg)
// ---------------------------------------------------------------------------

interface CachedSegment {
  key: string;
  fileName: string;
  durationSec: number;
  fetchedAtMs: number;
}

export class LiveHlsRingBuffer {
  private variantUrl: string;
  private refreshVariantFn?: () => Promise<string | null>;
  private ringDir: string;
  private initMapFile: string | null = null;
  private initMapUrl: string | null = null;
  private segments: CachedSegment[] = [];
  private seenKeys = new Set<string>();
  private segCounter = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private stopped = false;
  private consecutiveErrors = 0;

  constructor(opts: {
    streamId: string;
    variantUrl: string;
    refreshVariantFn?: () => Promise<string | null>;
  }) {
    this.variantUrl = opts.variantUrl;
    this.refreshVariantFn = opts.refreshVariantFn;
    this.ringDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `clipx-ring-${opts.streamId.slice(-8)}-`)
    );
  }

  start() {
    if (this.stopped || this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, 2000);
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      fs.rmSync(this.ringDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }

  getBufferedSeconds(): number {
    const total = this.segments.reduce((acc, s) => acc + s.durationSec, 0);
    return Number(Math.min(20, total).toFixed(1));
  }

  getTotalCachedSeconds(): number {
    return Number(
      this.segments.reduce((acc, s) => acc + s.durationSec, 0).toFixed(1)
    );
  }

  /**
   * Lightweight non-destructive audio peak check on the newest 2s live segment
   * so streamer screams & intense gunfights push the live Hype Index up even on
   * quiet / low-chat broadcasts.
   */
  async measureLatestAudioPeakDb(): Promise<number | null> {
    if (this.stopped || this.segments.length === 0) return null;
    const latest = this.segments[this.segments.length - 1];
    const segPath = path.join(this.ringDir, latest.fileName);
    if (!fs.existsSync(segPath)) return null;

    let inputTarget = segPath;
    let tempProbeFile: string | null = null;

    try {
      if (this.initMapFile) {
        const initPath = path.join(this.ringDir, this.initMapFile);
        if (!fs.existsSync(initPath)) return null;
        tempProbeFile = path.join(this.ringDir, "_audio_probe.mp4");
        fs.writeFileSync(
          tempProbeFile,
          Buffer.concat([fs.readFileSync(initPath), fs.readFileSync(segPath)])
        );
        inputTarget = tempProbeFile;
      }

      const stderr = await new Promise<string>((resolve) => {
        const proc = spawn(getFfmpegBin(), [
          "-hide_banner",
          "-i",
          inputTarget,
          "-vn",
          "-af",
          "astats=metadata=0:reset=0",
          "-f",
          "null",
          "-",
        ]);
        let out = "";
        proc.stderr.on("data", (c) => {
          out += c.toString();
        });
        proc.on("close", () => resolve(out));
        proc.on("error", () => resolve(""));
      });

      const peakMatches = Array.from(
        stderr.matchAll(/Peak level dB:\s*(-?\d+(?:\.\d+)?)/g)
      ).map((m) => Number(m[1]));
      const peak = peakMatches[peakMatches.length - 1];
      if (peak !== undefined && Number.isFinite(peak) && peak > -90) {
        return Number(peak.toFixed(1));
      }
      return null;
    } catch {
      return null;
    } finally {
      if (tempProbeFile) {
        try {
          fs.unlinkSync(tempProbeFile);
        } catch {
          // ignore
        }
      }
    }
  }

  async pollOnce(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;

    try {
      let res = await fetch(this.variantUrl, {
        headers: { "User-Agent": WEB_UA },
        signal: AbortSignal.timeout(7000),
      });

      // If token expired (403/404/410), auto-refresh live HLS variant URL
      if (!res.ok && this.refreshVariantFn) {
        const fresh = await this.refreshVariantFn();
        if (fresh) {
          this.variantUrl = fresh;
          res = await fetch(this.variantUrl, {
            headers: { "User-Agent": WEB_UA },
            signal: AbortSignal.timeout(7000),
          });
        }
      }
      if (!res.ok) {
        this.consecutiveErrors += 1;
        return;
      }

      const rawText = await res.text();
      // If variantUrl happens to be a master playlist, drill into best <=720p media playlist
      if (
        rawText.includes("#EXT-X-STREAM-INF:") &&
        !rawText.includes("#EXTINF:")
      ) {
        const sub = selectBestHlsVariant(rawText, this.variantUrl);
        if (sub && sub !== this.variantUrl) {
          this.variantUrl = sub;
          this.polling = false;
          return this.pollOnce();
        }
      }

      const lines = rawText.split(/\r?\n/).map((l) => l.trim());
      let mapUrl: string | null = null;
      const entries: Array<{ key: string; url: string; dur: number }> = [];
      let nextDur = 2.0;
      let skipNext = false;

      for (const line of lines) {
        if (!line) continue;
        if (
          line.startsWith("#EXT-X-DATERANGE:") &&
          /stitched-ad|twitch-stitched-ad|commercial/i.test(line)
        ) {
          skipNext = true;
          continue;
        }
        const mapMatch = line.match(/^#EXT-X-MAP:URI="([^"]+)"/i);
        if (mapMatch) {
          mapUrl = new URL(mapMatch[1], this.variantUrl).href;
          continue;
        }
        const infMatch = line.match(/^#EXTINF:([\d.]+)(?:,(.*))?/i);
        if (infMatch) {
          nextDur = Math.max(0.5, parseFloat(infMatch[1]) || 2.0);
          const tagTitle = infMatch[2] || "";
          if (/Amazon|stitched-ad|commercial/i.test(tagTitle)) {
            skipNext = true;
          }
          continue;
        }
        if (!line.startsWith("#")) {
          if (!skipNext) {
            const fullUrl = new URL(line, this.variantUrl).href;
            // Key strips volatile query tokens on CDN mirrors if pathname is unique
            const uObj = new URL(fullUrl);
            const key = uObj.pathname;
            entries.push({ key, url: fullUrl, dur: nextDur });
          }
          skipNext = false;
        }
      }

      // Download fMP4 init map if present & new
      if (mapUrl && mapUrl !== this.initMapUrl && !this.stopped) {
        const mRes = await fetch(mapUrl, {
          headers: { "User-Agent": WEB_UA },
          signal: AbortSignal.timeout(7000),
        });
        if (mRes.ok) {
          const buf = Buffer.from(await mRes.arrayBuffer());
          if (buf.length > 0 && !this.stopped) {
            const initName = "init_map.mp4";
            fs.writeFileSync(path.join(this.ringDir, initName), buf);
            this.initMapFile = initName;
            this.initMapUrl = mapUrl;
          }
        }
      }

      // Take only the latest ~24 seconds from playlist on initial fill
      const maxInitialSegs = 12;
      const candidates =
        this.segments.length === 0 ? entries.slice(-maxInitialSegs) : entries;
      const unseen = candidates.filter((e) => !this.seenKeys.has(e.key));

      const toFetch = unseen.slice(-12);
      // Fetch in fast ordered parallel batches of 4 so 24s of 1080p60 fills in <0.5s!
      for (let b = 0; b < toFetch.length && !this.stopped; b += 4) {
        const batch = toFetch.slice(b, b + 4);
        const results = await Promise.all(
          batch.map(async (seg) => {
            try {
              const sr = await fetch(seg.url, {
                headers: { "User-Agent": WEB_UA },
                signal: AbortSignal.timeout(12_000),
              });
              if (!sr.ok) return null;
              const buf = Buffer.from(await sr.arrayBuffer());
              if (buf.length < 256) return null;
              return { seg, buf };
            } catch {
              return null;
            }
          })
        );

        for (const item of results) {
          if (!item || this.stopped) continue;
          const ext = this.initMapFile ? "m4s" : "ts";
          const fileName = `seg_${String(this.segCounter++).padStart(
            5,
            "0"
          )}.${ext}`;
          fs.writeFileSync(path.join(this.ringDir, fileName), item.buf);

          this.seenKeys.add(item.seg.key);
          this.segments.push({
            key: item.seg.key,
            fileName,
            durationSec: item.seg.dur,
            fetchedAtMs: Date.now(),
          });
        }
      }

      // Keep bounded rolling window (~68s max in os.tmpdir()) so full 60s Shorts never prune mid-capture
      while (this.getTotalCachedSeconds() > 68 && this.segments.length > 32) {
        const oldest = this.segments.shift();
        if (oldest) {
          try {
            fs.unlinkSync(path.join(this.ringDir, oldest.fileName));
          } catch {
            // ignore
          }
        }
      }
      if (this.seenKeys.size > 200) {
        const recent = new Set(this.segments.map((s) => s.key));
        this.seenKeys = recent;
      }

      this.consecutiveErrors = 0;
    } catch {
      this.consecutiveErrors += 1;
    } finally {
      this.polling = false;
    }
  }

  /**
   * Locks the previous 20s of cached live segments, waits to gather `postBufferSec`
   * of real post-event live segments, and encodes a crisp H.264/AAC MP4 + poster.
   */
  async captureClip(params: {
    preBufferSec: number;
    postBufferSec: number;
    outputMp4Path: string;
    outputPosterPath: string;
    quality?: VideoQuality;
    onProgress?: (pct: number) => void;
  }): Promise<{
    durationSeconds: number;
    actualPreBufferSec: number;
    actualPostBufferSec: number;
    width: number;
    height: number;
    fileSizeBytes: number;
  }> {
    const qSpec = getQualitySpec(params.quality ?? "1080p_source");

    // Ensure we have the freshest playlist right at trigger time
    if (this.segments.length < 3) {
      await this.pollOnce();
    }

    // Select backwards from current tip until we accumulate full preBufferSec (20s)
    const preSegs: CachedSegment[] = [];
    let preAccum = 0;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      preSegs.unshift(this.segments[i]);
      preAccum += this.segments[i].durationSec;
      if (preAccum >= params.preBufferSec) break;
    }

    const lastPreFile = preSegs[preSegs.length - 1]?.fileName || "";
    params.onProgress?.(20);

    // Wait for the FULL postBufferSec of live segments (supports up to +40s = full 60s Shorts!)
    const postDeadline =
      Date.now() + Math.min(48_000, params.postBufferSec * 1000 + 2800);
    const postSegs: CachedSegment[] = [];
    let postAccum = 0;

    while (!this.stopped && postAccum < params.postBufferSec && Date.now() < postDeadline) {
      await sleep(1800);
      await this.pollOnce();

      const lastIdx = lastPreFile
        ? this.segments.findIndex((s) => s.fileName === lastPreFile)
        : -1;
      const newer =
        lastIdx >= 0 ? this.segments.slice(lastIdx + 1) : [];

      postSegs.length = 0;
      postAccum = 0;
      for (const ns of newer) {
        postSegs.push(ns);
        postAccum += ns.durationSec;
        if (postAccum >= params.postBufferSec) break;
      }
      const pct = Math.min(
        58,
        20 + Math.round((postAccum / Math.max(1, params.postBufferSec)) * 38)
      );
      params.onProgress?.(pct);
    }

    // Snapshot chosen segment files into an isolated capture folder so ring pruning can't touch them
    const selected = [...preSegs, ...postSegs].filter((s) =>
      fs.existsSync(path.join(this.ringDir, s.fileName))
    );
    if (selected.length === 0) {
      throw new Error(
        "No playable live video segments captured yet (stream may be running an ad break or just went offline). Try again in a few seconds."
      );
    }

    const capDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipx-cap-"));
    try {
      const maxSegDur = Math.max(
        4,
        Math.ceil(Math.max(...selected.map((s) => s.durationSec)))
      );
      const playlist: string[] = [
        "#EXTM3U",
        this.initMapFile ? "#EXT-X-VERSION:6" : "#EXT-X-VERSION:3",
        `#EXT-X-TARGETDURATION:${maxSegDur}`,
        "#EXT-X-MEDIA-SEQUENCE:0",
      ];

      if (
        this.initMapFile &&
        fs.existsSync(path.join(this.ringDir, this.initMapFile))
      ) {
        fs.copyFileSync(
          path.join(this.ringDir, this.initMapFile),
          path.join(capDir, "init.mp4")
        );
        playlist.push('#EXT-X-MAP:URI="init.mp4"');
      }

      selected.forEach((seg, idx) => {
        const ext = path.extname(seg.fileName) || ".ts";
        const dst = `c_${idx}${ext}`;
        fs.copyFileSync(
          path.join(this.ringDir, seg.fileName),
          path.join(capDir, dst)
        );
        playlist.push(`#EXTINF:${seg.durationSec.toFixed(3)},`, dst);
      });
      playlist.push("#EXT-X-ENDLIST");

      fs.writeFileSync(
        path.join(capDir, "capture.m3u8"),
        playlist.join("\n"),
        "utf8"
      );

      fs.mkdirSync(path.dirname(params.outputMp4Path), { recursive: true });
      fs.mkdirSync(path.dirname(params.outputPosterPath), { recursive: true });

      params.onProgress?.(68);
      const isTsContainer = !this.initMapFile;

      // 1. LOSSLESS 1080p60 SOURCE REMUX (-c:v copy -c:a copy) — 100% zero generation loss
      //    at the broadcaster's native 1920x1080 @ 60fps & full duration!
      let losslessOk = false;
      if (qSpec.allowLosslessCopy) {
        try {
          await runFfmpegSimple(
            [
              "-y",
              "-hide_banner",
              "-loglevel",
              "error",
              "-allowed_extensions",
              "ALL",
              "-i",
              "capture.m3u8",
              "-c:v",
              "copy",
              "-c:a",
              "copy",
              ...(isTsContainer ? ["-bsf:a", "aac_adtstoasc"] : []),
              "-movflags",
              "+faststart",
              path.resolve(params.outputMp4Path),
            ],
            capDir
          );
          const check = await probeMedia(params.outputMp4Path);
          if (
            check.durationSeconds >= 3 &&
            check.width >= 320 &&
            check.videoCodec === "h264"
          ) {
            losslessOk = true;
          }
        } catch {
          losslessOk = false;
        }
      }

      // 2. High-Bitrate Full HD H.264 High Profile encode (when user chose 1080p_high / 720p_balanced or non-H.264 stream)
      if (!losslessOk) {
        await runFfmpegSimple(
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-allowed_extensions",
            "ALL",
            "-i",
            "capture.m3u8",
            "-vf",
            `scale='min(${qSpec.landscapeW},iw)':-2:flags=lanczos,format=yuv420p`,
            "-c:v",
            "libx264",
            "-profile:v",
            "high",
            "-preset",
            qSpec.preset,
            "-crf",
            qSpec.crf,
            "-maxrate",
            qSpec.maxrate,
            "-bufsize",
            qSpec.bufsize,
            "-c:a",
            "aac",
            "-b:a",
            qSpec.audioBitrate,
            "-ar",
            "48000",
            "-movflags",
            "+faststart",
            path.resolve(params.outputMp4Path),
          ],
          capDir
        );
      }

      params.onProgress?.(94);
      const info = await probeMedia(params.outputMp4Path);
      const actualPre = Number(
        Math.min(
          info.durationSeconds,
          Math.min(params.preBufferSec, preAccum)
        ).toFixed(1)
      );
      const actualPost = Number(
        Math.max(0, info.durationSeconds - actualPre).toFixed(1)
      );

      await extractThumbnail(
        params.outputMp4Path,
        params.outputPosterPath,
        Math.min(Math.max(0.5, info.durationSeconds - 0.5), actualPre)
      );
      params.onProgress?.(100);

      return {
        durationSeconds: info.durationSeconds,
        actualPreBufferSec: actualPre,
        actualPostBufferSec: actualPost,
        width: info.width,
        height: info.height,
        fileSizeBytes: info.fileSizeBytes,
      };
    } finally {
      fs.rmSync(capDir, { recursive: true, force: true });
    }
  }
}

function runFfmpegSimple(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegBin(), args, cwd ? { cwd } : undefined);
    let stderr = "";
    proc.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `FFmpeg live clip encode failed (exit ${code}): ${stderr
              .trim()
              .slice(0, 260)}`
          )
        );
    });
  });
}
