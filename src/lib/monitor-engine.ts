import crypto from "node:crypto";
import path from "node:path";
import {
  analyzeChatMessage,
  checkDuplicateSuppression,
  computeAiClipScore,
  generateSmartSubtitles,
  type ScoringSignals,
} from "./ai-scoring";
import {
  getDb,
  getEffectiveSettings,
  mapChatRow,
  mapClipRow,
  mapStreamRow,
  mapSurgeRow,
  saveClipToExportsFolder,
  stripInternalClipPaths,
} from "./db";
import {
  analyzeMusicCopyright,
  captureRollingBufferClip,
  detectPeakMomentInVideo,
  renderEditedClip,
} from "./ffmpeg";
import {
  connectKickLiveChat,
  connectTwitchLiveChat,
  connectYoutubeLiveChat,
  type LiveChatHandle,
} from "./live-chat";
import {
  captureYoutubeLiveDvrClip,
  fetchTwitchHlsVariant,
  LiveHlsRingBuffer,
  resolveKickLive,
  resolveYoutubeLive,
} from "./live-sources";
import type {
  AutoDownloadBundleEvent,
  BufferSegment,
  CaptionConfig,
  ClipRecord,
  LiveBufferState,
  ProcessingJob,
  StreamRecord,
} from "./types";

interface WsLike {
  readyState: number;
  send: (data: string) => void;
}

interface ActiveSession {
  streamId: string;
  userId: string | null;
  isDemo: boolean;
  liveMode: "demo" | "hls_ring" | "youtube_dvr" | "file" | "chat_only";
  liveTargetId: string;
  hlsRing: LiveHlsRingBuffer | null;
  chatHandle: LiveChatHandle | null;
  startedAtMs: number;
  streamClockSec: number;
  sourceDurationSec: number;
  bufferDurationSec: number;
  segments: BufferSegment[];
  recentMsgTimestamps: number[];
  recentHypeEvents: Array<{ ts: number; kw: string }>;
  recentHypeKeywords: string[];
  baselineChatRate: number;
  currentChatRate: number;
  baselineAudioDb: number;
  videoMotionScore: number;
  audioPeakDb: number;
  audioProbing: boolean;
  combinedExcitement: number;
  captureState: LiveBufferState["captureState"];
  isCapturing: boolean;
  autoClipsCreated: number;
  ticksSinceStart: number;
  velocityHistory: Array<{
    time: string;
    ratePerMin: number;
    baseline: number;
    isSpike: boolean;
  }>;
  timer: ReturnType<typeof setInterval> | null;
}

interface EngineState {
  sessions: Map<string, ActiveSession>;
  jobs: Map<string, ProcessingJob>;
}

declare global {
  // eslint-disable-next-line no-var
  var __clipxWsClients: Set<WsLike> | undefined;
  // eslint-disable-next-line no-var
  var __clipxEngine: EngineState | undefined;
}

function getEngine(): EngineState {
  if (!globalThis.__clipxEngine) {
    globalThis.__clipxEngine = {
      sessions: new Map(),
      jobs: new Map(),
    };
  }
  return globalThis.__clipxEngine;
}

export function broadcastWs(event: string, payload: unknown) {
  const clients = globalThis.__clipxWsClients;
  if (!clients || clients.size === 0) return;
  const msg = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
  });
  clients.forEach((ws) => {
    try {
      if (ws.readyState === 1) ws.send(msg);
    } catch {
      // ignore disconnected socket
    }
  });
}

export function upsertJob(job: ProcessingJob) {
  const engine = getEngine();
  engine.jobs.set(job.id, job);
  if (engine.jobs.size > 16) {
    const firstKey = engine.jobs.keys().next().value;
    if (firstKey) engine.jobs.delete(firstKey);
  }
  broadcastWs("job_update", job);
}

export function getRecentJobs(): ProcessingJob[] {
  const engine = getEngine();
  return Array.from(engine.jobs.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

const DEMO_CHATTERS = [
  "vex_aim",
  "nova99",
  "synth_kai",
  "mira_plays",
  "draco_gg",
  "pixelated_k",
  "lumen_fps",
  "koda_live",
  "turbo_zed",
  "arc_rider",
  "zenith_op",
  "shiro_val",
  "blitz_eu",
  "echo_na",
];

const DEMO_CALM_LINES = [
  "nice rotation through mid",
  "holding B angle with 20s buffer active",
  "utility economy looks solid this round",
  "crosshair placement so clean",
  "watch the flank near neon sign",
  "footsteps left side careful",
  "that drift entry line is smooth",
  "chat who wins map 3?",
  "ping looks super stable today",
  "patience here pays off",
];

const DEMO_SPIKE_CLUTCH = [
  "WAIT TWO HEADSHOTS ALREADY!!",
  "NO WAY HE WINS THIS 1V5!!",
  "ACEEEE!! CLIP IT RIGHT NOW!!",
  "OMG WHAT WAS THAT FLICK?! INSANE!",
  "CLIP THAT!! 1V5 CLUTCH IN OVERTIME!!",
  "GOAT BEHAVIOR LETS GO W!!",
  "HOLY HEADSHOT CLIP IT CLIP IT!!",
  "POGGERS CRAZY RETAKE!!",
];

const DEMO_SPIKE_MUSIC = [
  "THAT NITRO DRIFT ENTRY WHAT!!",
  "WORLD RECORD PACE NO WAY!!",
  "CLIP IT!! +0.012s RECORD FINISH!!",
  "INSANE HAIRPIN LINE LETS GO!!",
  "OMG NEW COURSE RECORD W!!",
  "CRAZY OVERTIME SPEED CLIP THAT!!",
  "note: radio synthwave music is playing btw",
];

function formatTimeLabel(date = new Date()): string {
  return date.toTimeString().slice(0, 8);
}

interface ParsedDescriptor {
  scheme:
    | "twitch-live"
    | "twitch-chat"
    | "youtube-live"
    | "youtube-hls"
    | "youtube-chat"
    | "kick-live"
    | "hls-url"
    | "file"
    | "none";
  target: string;
  query: URLSearchParams;
}

function parseSourceDescriptor(stream: StreamRecord): ParsedDescriptor {
  const src = stream.localSourcePath || "";
  const empty = new URLSearchParams();

  if (src.startsWith("twitch-live://")) {
    return {
      scheme: "twitch-live",
      target: src.slice("twitch-live://".length).split("?")[0],
      query: empty,
    };
  }
  if (src.startsWith("twitch-chat://")) {
    return {
      scheme: "twitch-chat",
      target: src.slice("twitch-chat://".length).split("?")[0],
      query: empty,
    };
  }
  if (src.startsWith("youtube-live://")) {
    return {
      scheme: "youtube-live",
      target: src.slice("youtube-live://".length).split("?")[0],
      query: empty,
    };
  }
  if (src.startsWith("youtube-hls://")) {
    return {
      scheme: "youtube-hls",
      target: src.slice("youtube-hls://".length).split("?")[0],
      query: empty,
    };
  }
  if (src.startsWith("youtube-chat://")) {
    return {
      scheme: "youtube-chat",
      target: src.slice("youtube-chat://".length).split("?")[0],
      query: empty,
    };
  }
  if (src.startsWith("kick-live://")) {
    const rest = src.slice("kick-live://".length);
    const [slug, qs] = rest.split("?");
    return {
      scheme: "kick-live",
      target: slug,
      query: new URLSearchParams(qs || ""),
    };
  }
  if (/^https?:\/\//i.test(src) && /\.m3u8(\?|$)/i.test(src)) {
    return { scheme: "hls-url", target: src, query: empty };
  }
  if (
    stream.platform === "hls" &&
    /\.m3u8(\?|$)/i.test(stream.streamUrl)
  ) {
    return { scheme: "hls-url", target: stream.streamUrl, query: empty };
  }
  if (src) {
    return { scheme: "file", target: src, query: empty };
  }
  if (stream.platform === "hls" && /^https?:\/\//i.test(stream.streamUrl)) {
    return { scheme: "file", target: stream.streamUrl, query: empty };
  }
  return { scheme: "none", target: "", query: empty };
}

export function serializeSessionBuffer(
  session: ActiveSession,
  stream: StreamRecord
): LiveBufferState {
  let cooldownRemaining = 0;
  if (stream.lastClipEventAt) {
    const elapsed =
      (Date.now() - new Date(stream.lastClipEventAt).getTime()) / 1000;
    cooldownRemaining = Math.max(
      0,
      Math.ceil(stream.dedupeCooldownSeconds - elapsed)
    );
  }
  const mult =
    session.baselineChatRate > 0
      ? Number(
          (
            session.currentChatRate / Math.max(8, session.baselineChatRate)
          ).toFixed(2)
        )
      : session.currentChatRate > 0
      ? 1
      : 0;

  return {
    streamId: session.streamId,
    isDemo: session.isDemo,
    active: true,
    bufferDurationSec: Number(session.bufferDurationSec.toFixed(1)),
    targetBufferSec: 20,
    postBufferSec: stream.postBufferSeconds,
    currentStreamTimeSec: Number(session.streamClockSec.toFixed(1)),
    chatRatePerMin: Math.round(session.currentChatRate),
    baselineChatRatePerMin: Math.round(session.baselineChatRate),
    chatMultiplier: mult,
    videoMotionScore: Math.round(session.videoMotionScore),
    audioPeakDb: Number(session.audioPeakDb.toFixed(1)),
    combinedExcitement: Math.round(session.combinedExcitement),
    threshold: stream.minAiScore,
    hypeThreshold: stream.hypeThreshold,
    autoShortsEnabled: stream.autoShortsEnabled,
    autoDownloadEnabled: stream.autoDownloadEnabled,
    cooldownRemainingSec: cooldownRemaining,
    captureState: session.captureState,
    liveChatConnected: session.chatHandle
      ? session.chatHandle.isConnected()
      : false,
    liveChatSource: session.chatHandle?.source,
    segments: session.segments,
    updatedAt: new Date().toISOString(),
  };
}

export function getAllBufferStates(): Record<string, LiveBufferState> {
  const db = getDb();
  const engine = getEngine();
  const out: Record<string, LiveBufferState> = {};

  engine.sessions.forEach((session, streamId) => {
    const row = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(streamId) as Record<string, unknown> | undefined;
    if (row) {
      out[streamId] = serializeSessionBuffer(session, mapStreamRow(row));
    }
  });
  return out;
}

export function getStreamVelocityHistory(streamId: string) {
  const engine = getEngine();
  const session = engine.sessions.get(streamId);
  if (session && session.velocityHistory.length > 0) {
    return session.velocityHistory.slice(-24);
  }
  if (streamId === "stream-demo-sandbox") {
    const base = 28;
    const pts = [
      24, 26, 29, 25, 30, 32, 28, 34, 96, 144, 118, 52, 34, 28, 26, 30,
    ];
    return pts.map((r, idx) => ({
      time: `-${(pts.length - idx) * 5}s`,
      ratePerMin: r,
      baseline: base,
      isSpike: r >= base * 2.6,
    }));
  }
  return [];
}

function insertLiveChatMessage(params: {
  streamId: string;
  author: string;
  message: string;
  isDemo: boolean;
  rateOnly?: boolean;
  session?: ActiveSession;
}) {
  const analysis = analyzeChatMessage(params.message);
  const nowMs = Date.now();

  if (params.session) {
    params.session.recentMsgTimestamps.push(nowMs);
    if (analysis.matchedKeywords.length > 0) {
      for (const kw of analysis.matchedKeywords) {
        params.session.recentHypeEvents.push({ ts: nowMs, kw });
      }
      params.session.recentHypeKeywords.push(...analysis.matchedKeywords);
      params.session.recentHypeKeywords =
        params.session.recentHypeKeywords.slice(-20);
    }
  }

  if (params.rateOnly) {
    return null;
  }

  const db = getDb();
  const id = `msg-${crypto.randomUUID().slice(0, 10)}`;
  const nowIso = new Date(nowMs).toISOString();

  db.prepare(
    `INSERT INTO chat_messages (id, stream_id, author, message, excitement_score, matched_keywords, is_spike, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.streamId,
    params.author,
    params.message,
    analysis.excitementScore,
    analysis.matchedKeywords.join(","),
    analysis.isSpikeCandidate ? 1 : 0,
    params.isDemo ? 1 : 0,
    nowIso
  );

  // Keep last 200 messages per stream
  db.prepare(
    `DELETE FROM chat_messages WHERE stream_id = ? AND id NOT IN (
      SELECT id FROM chat_messages WHERE stream_id = ? ORDER BY created_at DESC LIMIT 200
    )`
  ).run(params.streamId, params.streamId);

  const row = db
    .prepare("SELECT * FROM chat_messages WHERE id = ?")
    .get(id) as Record<string, unknown>;
  const record = mapChatRow(row);
  broadcastWs("chat_message", record);
  return record;
}

export async function startStreamMonitoring(
  streamId: string,
  userId: string | null
): Promise<{ stream: StreamRecord; buffer: LiveBufferState }> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(streamId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Stream not found.");

  const stream = mapStreamRow(row);

  if (
    stream.status === "offline" ||
    stream.status === "error" ||
    stream.status === "credentials_required"
  ) {
    throw new Error(
      `Cannot start monitoring: stream is currently ${stream.status}. Click "Re-check Live" once the broadcaster is live.`
    );
  }

  const engine = getEngine();
  const existing = engine.sessions.get(streamId);
  if (existing) {
    return { stream, buffer: serializeSessionBuffer(existing, stream) };
  }

  const desc = parseSourceDescriptor(stream);
  let hlsRing: LiveHlsRingBuffer | null = null;
  let chatHandle: LiveChatHandle | null = null;
  let liveMode: ActiveSession["liveMode"] = stream.isDemo ? "demo" : "file";
  let liveTargetId = desc.target;

  const streamQuality =
    stream.videoQuality ||
    getEffectiveSettings(userId).videoQuality ||
    "1080p_source";

  // Set up real continuous 20-second rolling live buffer (ZERO API KEY — 1080p60 Source!)
  if (!stream.isDemo) {
    if (desc.scheme === "twitch-live") {
      const variant = await fetchTwitchHlsVariant(desc.target, streamQuality);
      if (!variant) {
        db.prepare(
          "UPDATE streams SET status = 'offline', status_reason = ? WHERE id = ?"
        ).run(
          `Twitch stream "${stream.channelName}" went offline or became restricted. Click Re-check Live to refresh.`,
          streamId
        );
        throw new Error(
          `Twitch channel "${stream.channelName}" is no longer serving a public live feed.`
        );
      }
      liveMode = "hls_ring";
      hlsRing = new LiveHlsRingBuffer({
        streamId,
        variantUrl: variant,
        refreshVariantFn: () =>
          fetchTwitchHlsVariant(desc.target, streamQuality),
      });
    } else if (desc.scheme === "youtube-hls") {
      const fresh = await resolveYoutubeLive(desc.target, streamQuality);
      if (!fresh.isLive) {
        db.prepare(
          "UPDATE streams SET status = 'offline', status_reason = ? WHERE id = ?"
        ).run(fresh.statusReason, streamId);
        throw new Error(fresh.statusReason);
      }
      if (fresh.hlsVariantUrl) {
        liveMode = "hls_ring";
        hlsRing = new LiveHlsRingBuffer({
          streamId,
          variantUrl: fresh.hlsVariantUrl,
          refreshVariantFn: async () =>
            (await resolveYoutubeLive(desc.target, streamQuality))
              .hlsVariantUrl || null,
        });
      } else {
        liveMode = "youtube_dvr";
      }
    } else if (desc.scheme === "youtube-live") {
      liveMode = "youtube_dvr";
    } else if (desc.scheme === "kick-live") {
      let variant = desc.query.get("hls") || null;
      if (!variant) {
        const fresh = await resolveKickLive(desc.target, streamQuality);
        variant = fresh.hlsVariantUrl || null;
      }
      if (variant) {
        liveMode = "hls_ring";
        hlsRing = new LiveHlsRingBuffer({
          streamId,
          variantUrl: variant,
          refreshVariantFn: async () =>
            (await resolveKickLive(desc.target, streamQuality)).hlsVariantUrl ||
            null,
        });
      } else {
        liveMode = "chat_only";
      }
    } else if (desc.scheme === "hls-url") {
      liveMode = "hls_ring";
      hlsRing = new LiveHlsRingBuffer({
        streamId,
        variantUrl: desc.target,
      });
    } else if (
      desc.scheme === "twitch-chat" ||
      desc.scheme === "youtube-chat"
    ) {
      liveMode = "chat_only";
    } else {
      liveMode = "file";
    }
  }

  const initialSegments: BufferSegment[] = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    startSec: i * 2,
    endSec: (i + 1) * 2,
    excitement: 24 + ((i * 7) % 16),
    filled: stream.isDemo ? i < 6 : liveMode === "youtube_dvr",
  }));

  const session: ActiveSession = {
    streamId,
    userId,
    isDemo: stream.isDemo,
    liveMode,
    liveTargetId,
    hlsRing,
    chatHandle: null,
    startedAtMs: Date.now(),
    streamClockSec: stream.isDemo ? 12 : 0,
    sourceDurationSec: stream.isDemo ? 54 : 36000,
    bufferDurationSec: stream.isDemo
      ? 12
      : liveMode === "youtube_dvr"
      ? 20
      : 0,
    segments: initialSegments,
    recentMsgTimestamps: [],
    recentHypeEvents: [],
    recentHypeKeywords: [],
    baselineChatRate: stream.isDemo ? 28 : 0,
    currentChatRate: stream.isDemo ? 26 : 0,
    baselineAudioDb: -18,
    videoMotionScore: 48,
    audioPeakDb: -20,
    audioProbing: false,
    combinedExcitement: 40,
    captureState: liveMode === "youtube_dvr" ? "idle" : "buffering",
    isCapturing: false,
    autoClipsCreated: 0,
    ticksSinceStart: 0,
    velocityHistory: [],
    timer: null,
  };

  // Start continuous live 1080p60 HLS rolling ring buffer:
  // Fill full 20s pre-buffer FIRST (in parallel batches), then start 2s live polling timer!
  if (hlsRing) {
    await hlsRing.pollOnce().catch(() => null);
    hlsRing.start();
    session.bufferDurationSec = hlsRing.getBufferedSeconds();
    if (session.bufferDurationSec >= 20) {
      session.captureState = "idle";
      session.segments = session.segments.map((s) => ({ ...s, filled: true }));
    }
  }

  // Attach real keyless live chat connector (Twitch IRC / YouTube Live Chat / Kick Pusher)
  if (!stream.isDemo) {
    const onIncomingChat = (msg: {
      author: string;
      message: string;
      rateOnly?: boolean;
    }) => {
      try {
        insertLiveChatMessage({
          streamId,
          author: msg.author,
          message: msg.message,
          isDemo: false,
          rateOnly: msg.rateOnly,
          session,
        });
      } catch {
        // ignore transient errors
      }
    };

    if (
      desc.scheme === "twitch-live" ||
      desc.scheme === "twitch-chat"
    ) {
      chatHandle = connectTwitchLiveChat(desc.target, onIncomingChat);
    } else if (
      desc.scheme === "youtube-live" ||
      desc.scheme === "youtube-hls" ||
      desc.scheme === "youtube-chat"
    ) {
      chatHandle = connectYoutubeLiveChat(desc.target, onIncomingChat);
    } else if (desc.scheme === "kick-live") {
      const roomId = Number(desc.query.get("chatroom") || 0);
      if (roomId > 0) {
        chatHandle = connectKickLiveChat(roomId, desc.target, onIncomingChat);
      }
    }
    session.chatHandle = chatHandle;
  }

  const activeReason = stream.isDemo
    ? "DEMO SIMULATION ACTIVE — Rolling 20s video buffer + simulated live chat spike detector running (not a live external stream)."
    : liveMode === "hls_ring"
    ? `LIVE MONITORING (${stream.platform.toUpperCase()} · No API Key) — Continuous 20s live video ring buffer${
        chatHandle ? ` + real-time ${chatHandle.source}` : ""
      } active. Auto-clips chat surges or click "Clip Last 20s Now" anytime.`
    : liveMode === "youtube_dvr"
    ? `LIVE MONITORING (YOUTUBE · No API Key) — Live 20s DVR rolling buffer + real-time YouTube Live Chat active. Auto-clips chat surges or click "Clip Last 20s Now" anytime.`
    : liveMode === "chat_only"
    ? `LIVE CHAT MONITORING (${stream.platform.toUpperCase()}) — Real-time viewer chat velocity & hype keyword tracking active (stream video is restricted by broadcaster).`
    : `LIVE MONITORING — Rolling 20s FFmpeg buffer active on ${stream.platform.toUpperCase()} video source.`;

  db.prepare(
    "UPDATE streams SET status = 'monitoring', status_reason = ? WHERE id = ?"
  ).run(activeReason, streamId);

  session.timer = setInterval(() => {
    tickSession(session);
  }, 2000);

  engine.sessions.set(streamId, session);

  // Automatic FFmpeg peak detection for user-uploaded MP4/WebM/MOV files
  if (!stream.isDemo && stream.platform === "upload" && stream.localSourcePath) {
    const localFile = stream.localSourcePath;
    setTimeout(async () => {
      const stillActive = getEngine().sessions.get(streamId);
      if (!stillActive || stillActive.isCapturing || stillActive.autoClipsCreated > 0)
        return;
      try {
        const peak = await detectPeakMomentInVideo(localFile);
        stillActive.streamClockSec = Math.max(20, peak.eventTimeSec);
        stillActive.bufferDurationSec = 20;
        stillActive.videoMotionScore = peak.motionScore;
        stillActive.audioPeakDb = -6;
        await executeClipCapture({
          streamId,
          userId,
          scenario: "authorized_auto",
          customEventTimeSec: peak.eventTimeSec,
          customPeakDeltaDb: peak.peakDeltaDb,
          customMotionScore: peak.motionScore,
        });
        stillActive.autoClipsCreated += 1;
      } catch {
        // non-fatal
      }
    }, 3500);
  }

  const updated = mapStreamRow(
    db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<
      string,
      unknown
    >
  );
  const buffer = serializeSessionBuffer(session, updated);
  broadcastWs("stream_updated", updated);
  broadcastWs("buffer_tick", buffer);

  return { stream: updated, buffer };
}

export function stopStreamMonitoring(streamId: string): StreamRecord {
  const db = getDb();
  const engine = getEngine();
  const session = engine.sessions.get(streamId);
  if (session) {
    if (session.timer) clearInterval(session.timer);
    if (session.hlsRing) session.hlsRing.stop();
    if (session.chatHandle) session.chatHandle.stop();
    engine.sessions.delete(streamId);
  }

  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(streamId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Stream not found.");
  const current = mapStreamRow(row);

  const nextStatus = current.status === "monitoring" ? "ready" : current.status;
  const nextReason = current.isDemo
    ? "Demo simulation paused — click Start Monitoring to resume the 20s rolling buffer."
    : current.status === "monitoring"
    ? `Monitoring paused on ${current.channelName} (${current.platform.toUpperCase()}). Click Start Monitoring to reconnect the live 20s buffer & live chat.`
    : current.statusReason;

  db.prepare(
    "UPDATE streams SET status = ?, status_reason = ? WHERE id = ?"
  ).run(nextStatus, nextReason, streamId);

  const updated = mapStreamRow(
    db.prepare("SELECT * FROM streams WHERE id = ?").get(streamId) as Record<
      string,
      unknown
    >
  );
  broadcastWs("stream_updated", updated);
  broadcastWs("buffer_stopped", { streamId });
  return updated;
}

function tickSession(session: ActiveSession) {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(session.streamId) as Record<string, unknown> | undefined;
  if (!row) {
    stopStreamMonitoring(session.streamId);
    return;
  }
  const stream = mapStreamRow(row);
  const settings = getEffectiveSettings(session.userId);
  session.ticksSinceStart += 1;

  // Advance clock & rolling 20s buffer duration
  session.streamClockSec = session.isDemo
    ? (session.streamClockSec + 2) % Math.max(30, session.sourceDurationSec)
    : session.streamClockSec + 2;

  if (session.liveMode === "hls_ring" && session.hlsRing) {
    session.bufferDurationSec = session.hlsRing.getBufferedSeconds();
  } else if (session.liveMode === "youtube_dvr") {
    session.bufferDurationSec = 20;
  } else if (session.liveMode === "chat_only") {
    session.bufferDurationSec = 0;
  } else {
    session.bufferDurationSec = Math.min(20, session.bufferDurationSec + 2);
  }

  if (!session.isCapturing) {
    session.captureState =
      session.bufferDurationSec >= 18 ? "idle" : "buffering";
  }

  const now = Date.now();
  const cutoff15s = now - 15_000;
  const cutoff12s = now - 12_000;

  if (session.isDemo) {
    // Emit simulated chat ONLY in Demo Sandbox mode
    const msgCount = Math.random() < 0.75 ? 1 : 2;
    for (let i = 0; i < msgCount; i++) {
      const author =
        DEMO_CHATTERS[Math.floor(Math.random() * DEMO_CHATTERS.length)];
      const line =
        DEMO_CALM_LINES[Math.floor(Math.random() * DEMO_CALM_LINES.length)];
      insertLiveChatMessage({
        streamId: session.streamId,
        author,
        message: line,
        isDemo: true,
        session,
      });
    }

    session.recentMsgTimestamps = session.recentMsgTimestamps.filter(
      (t) => t >= cutoff15s
    );
    session.currentChatRate = Math.max(
      18,
      session.recentMsgTimestamps.length * 4
    );
    const mult =
      session.currentChatRate / Math.max(10, session.baselineChatRate);

    session.videoMotionScore = session.isCapturing
      ? 91
      : Math.round(44 + 14 * Math.sin(session.ticksSinceStart * 0.6));
    session.audioPeakDb = session.isCapturing
      ? -5.4
      : Number((-26 + 5 * Math.cos(session.ticksSinceStart * 0.5)).toFixed(1));
    session.combinedExcitement = Math.min(
      99,
      Math.round(
        session.videoMotionScore * 0.45 + Math.min(100, mult * 22) * 0.55
      )
    );

    session.velocityHistory.push({
      time: formatTimeLabel(),
      ratePerMin: Math.round(session.currentChatRate),
      baseline: Math.round(session.baselineChatRate),
      isSpike: mult >= settings.chatSpikeMultiplier,
    });
    if (session.velocityHistory.length > 30) session.velocityHistory.shift();

    if (
      session.bufferDurationSec >= 20 &&
      !session.isCapturing &&
      session.autoClipsCreated < 2 &&
      session.ticksSinceStart > 0 &&
      session.ticksSinceStart % 18 === 0
    ) {
      session.autoClipsCreated += 1;
      const scenario =
        session.autoClipsCreated % 2 === 1 ? "clutch" : "music_record";
      void executeClipCapture({
        streamId: session.streamId,
        userId: session.userId,
        scenario,
      }).catch(() => null);
    }
  } else {
    // REAL LIVE STREAM TELEMETRY (Twitch / YouTube Live / Kick / HLS / Upload)
    session.recentMsgTimestamps = session.recentMsgTimestamps.filter(
      (t) => t >= cutoff15s
    );
    session.recentHypeEvents = session.recentHypeEvents.filter(
      (e) => e.ts >= cutoff12s
    );

    // Real messages per minute computed strictly from incoming real viewer messages
    session.currentChatRate = session.recentMsgTimestamps.length * 4;

    if (session.currentChatRate > 0) {
      if (session.baselineChatRate <= 0) {
        session.baselineChatRate = Math.max(12, session.currentChatRate);
      } else if (
        session.currentChatRate <
        session.baselineChatRate * settings.chatSpikeMultiplier
      ) {
        // Smooth adaptive EMA baseline during normal chatter
        session.baselineChatRate = Number(
          (
            session.baselineChatRate * 0.88 +
            Math.max(10, session.currentChatRate) * 0.12
          ).toFixed(1)
        );
      }
    }

    // Periodically sample real audio peak dB on the newest 2s live segment (zero-modify)
    if (
      session.liveMode === "hls_ring" &&
      session.hlsRing &&
      !session.isCapturing &&
      !session.audioProbing &&
      session.ticksSinceStart % 2 === 0
    ) {
      session.audioProbing = true;
      session.hlsRing
        .measureLatestAudioPeakDb()
        .then((peakDb) => {
          if (peakDb !== null) {
            session.audioPeakDb = peakDb;
            // Adaptive baseline audio peak (EMA on non-scream ticks)
            if (session.ticksSinceStart <= 4) {
              session.baselineAudioDb = peakDb;
            } else if (peakDb < session.baselineAudioDb + 7) {
              session.baselineAudioDb = Number(
                (session.baselineAudioDb * 0.85 + peakDb * 0.15).toFixed(1)
              );
            }
          }
        })
        .finally(() => {
          session.audioProbing = false;
        });
    }

    const effectiveBase = Math.max(10, session.baselineChatRate || 14);
    const mult =
      session.currentChatRate > 0 ? session.currentChatRate / effectiveBase : 0;
    const hypeCount = session.recentHypeEvents.length;
    const audioJumpDb = Math.max(
      0,
      session.audioPeakDb - session.baselineAudioDb
    );

    // Unified 0–100 Live Hype Index combining chat surge + hype keywords + live audio reaction jump
    const chatContribution = Math.min(44, Math.round(mult * 15));
    const keywordContribution = Math.min(30, hypeCount * 8);
    const audioContribution = Math.min(28, Math.round(audioJumpDb * 2.8));

    session.combinedExcitement = session.isCapturing
      ? 95
      : Math.min(
          99,
          Math.max(
            24,
            26 + chatContribution + keywordContribution + audioContribution
          )
        );
    session.videoMotionScore = session.isCapturing
      ? 92
      : Math.min(
          96,
          Math.round(46 + audioContribution * 1.1 + keywordContribution * 0.8)
        );

    const targetHype = stream.hypeThreshold || settings.hypeThreshold || 70;
    const cooldownElapsed = stream.lastClipEventAt
      ? (Date.now() - new Date(stream.lastClipEventAt).getTime()) / 1000
      : 9999;
    const cooldownClear = cooldownElapsed >= stream.dedupeCooldownSeconds;

    const hitHypeThreshold =
      session.ticksSinceStart >= 4 &&
      (session.combinedExcitement >= targetHype ||
        (mult >= settings.chatSpikeMultiplier && session.currentChatRate >= 24));

    session.velocityHistory.push({
      time: formatTimeLabel(),
      ratePerMin: Math.round(session.currentChatRate),
      baseline: Math.round(session.baselineChatRate || 0),
      isSpike: hitHypeThreshold,
    });
    if (session.velocityHistory.length > 30) session.velocityHistory.shift();

    // HANDS-FREE HYPE TRIGGER: Save Original 16:9 + Auto 9:16 Short + Auto-Download Both!
    if (
      hitHypeThreshold &&
      cooldownClear &&
      !session.isCapturing &&
      (session.liveMode === "hls_ring" || session.liveMode === "youtube_dvr") &&
      session.bufferDurationSec >= 14
    ) {
      session.autoClipsCreated += 1;
      void executeClipCapture({
        streamId: session.streamId,
        userId: session.userId,
        scenario: "live_chat_spike",
        triggerHypeScore: session.combinedExcitement,
      }).catch(() => null);
    }
  }

  // Update 10 rolling 2s segments representing the 20s pre-event buffer
  const filledCount = Math.min(10, Math.round(session.bufferDurationSec / 2));
  const shifted = session.segments.slice(1).map((s, idx) => ({
    ...s,
    index: idx,
    startSec: idx * 2,
    endSec: (idx + 1) * 2,
    filled: idx < filledCount,
  }));
  shifted.push({
    index: 9,
    startSec: 18,
    endSec: 20,
    excitement: session.combinedExcitement,
    filled: filledCount >= 10,
  });
  session.segments = shifted;

  broadcastWs("buffer_tick", serializeSessionBuffer(session, stream));
}

export function injectDemoChatBurst(
  streamId: string,
  customMessages?: string[]
): { added: number; currentRatePerMin: number } {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(streamId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Stream not found.");
  const stream = mapStreamRow(row);
  if (!stream.isDemo) {
    throw new Error(
      "Simulated chat bursts are restricted to Demo Sandbox streams. Real live streams display authentic viewer chat."
    );
  }

  const session = getEngine().sessions.get(streamId);
  const lines =
    customMessages && customMessages.length > 0
      ? customMessages
      : DEMO_SPIKE_CLUTCH;

  for (const text of lines) {
    const author =
      DEMO_CHATTERS[Math.floor(Math.random() * DEMO_CHATTERS.length)];
    insertLiveChatMessage({
      streamId,
      author,
      message: text,
      isDemo: true,
      session,
    });
  }

  if (session) {
    const cutoff = Date.now() - 15_000;
    session.recentMsgTimestamps = session.recentMsgTimestamps.filter(
      (t) => t >= cutoff
    );
    session.currentChatRate = session.recentMsgTimestamps.length * 4;
    session.velocityHistory.push({
      time: formatTimeLabel(),
      ratePerMin: Math.round(session.currentChatRate),
      baseline: Math.round(session.baselineChatRate),
      isSpike: true,
    });
  }

  return {
    added: lines.length,
    currentRatePerMin: session
      ? Math.round(session.currentChatRate)
      : lines.length * 16,
  };
}

export async function executeClipCapture(params: {
  streamId: string;
  userId: string | null;
  scenario:
    | "clutch"
    | "music_record"
    | "manual"
    | "authorized_auto"
    | "live_chat_spike";
  bypassCooldown?: boolean;
  customEventTimeSec?: number;
  customPeakDeltaDb?: number;
  customMotionScore?: number;
  triggerHypeScore?: number;
  createShortOverride?: boolean;
  autoDownloadOverride?: boolean;
}): Promise<{
  status: "created" | "duplicate_suppressed" | "below_threshold";
  clip?: ClipRecord;
  shortClip?: ClipRecord | null;
  exportFiles?: string[];
  autoDownloadStatus?: "ready" | "copyright_hold" | "off";
  message: string;
}> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM streams WHERE id = ?")
    .get(params.streamId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Stream not found.");
  const stream = mapStreamRow(row);

  if (
    !stream.isDemo &&
    (stream.status === "credentials_required" ||
      stream.status === "offline" ||
      stream.status === "error")
  ) {
    throw new Error(
      `Stream "${stream.channelName}" is currently ${stream.status}. Click "Re-check Live" when the channel is broadcasting.`
    );
  }

  const engine = getEngine();
  const session = engine.sessions.get(params.streamId);
  const settings = getEffectiveSettings(params.userId);
  const postBufferSec =
    stream.postBufferSeconds || settings.postBufferSeconds || 8;
  const cooldownSec =
    stream.dedupeCooldownSeconds || settings.dedupeCooldownSeconds || 25;

  // Gather chat spike metrics (simulated in demo, 100% authentic on real live streams)
  let topKeywords: string[] = [];
  let peakRate = 0;
  let baselineRate = stream.isDemo
    ? 28
    : Math.max(12, Math.round(session?.baselineChatRate || 18));

  if (stream.isDemo && params.scenario !== "manual") {
    const lines =
      params.scenario === "music_record" ? DEMO_SPIKE_MUSIC : DEMO_SPIKE_CLUTCH;
    const burst = injectDemoChatBurst(params.streamId, lines);
    peakRate = Math.max(124, burst.currentRatePerMin * 3);
    topKeywords =
      params.scenario === "music_record"
        ? ["WORLD RECORD", "CLIP IT", "NO WAY", "INSANE"]
        : ["1V5", "ACE", "CLIP IT", "CLUTCH"];
  } else if (stream.isDemo) {
    peakRate = session ? Math.max(68, Math.round(session.currentChatRate)) : 72;
    topKeywords = ["CLIP IT", "CLEAN"];
  } else if (session) {
    peakRate = Math.round(session.currentChatRate);
    baselineRate = Math.max(12, Math.round(session.baselineChatRate || 16));
    topKeywords = Array.from(new Set(session.recentHypeKeywords)).slice(-5);
  }

  // 1. Duplicate Clip Prevention Gate
  if (!params.bypassCooldown) {
    const dupe = checkDuplicateSuppression({
      lastClipEventAtIso: stream.lastClipEventAt,
      cooldownSeconds: cooldownSec,
      isCurrentlyCapturing: Boolean(session?.isCapturing),
    });

    if (dupe.isDuplicate) {
      const surgeId = `surge-${crypto.randomUUID().slice(0, 10)}`;
      const mult =
        baselineRate > 0 && peakRate > 0
          ? Number((peakRate / baselineRate).toFixed(2))
          : 1;
      db.prepare(
        `INSERT INTO chat_surges (
          id, stream_id, clip_id, channel_name, peak_rate_per_min, baseline_rate_per_min,
          multiplier, top_keywords, outcome, outcome_note, is_demo, created_at
        ) VALUES (?, ?, null, ?, ?, ?, ?, ?, 'duplicate_suppressed', ?, ?, ?)`
      ).run(
        surgeId,
        stream.id,
        stream.channelName,
        peakRate,
        baselineRate,
        mult,
        (topKeywords.length ? topKeywords : ["SPIKE"]).join(","),
        dupe.reason,
        stream.isDemo ? 1 : 0,
        new Date().toISOString()
      );

      const surgeRec = mapSurgeRow(
        db
          .prepare("SELECT * FROM chat_surges WHERE id = ?")
          .get(surgeId) as Record<string, unknown>
      );
      broadcastWs("chat_surge", surgeRec);
      broadcastWs("duplicate_suppressed", {
        streamId: stream.id,
        reason: dupe.reason,
        remainingSec: dupe.remainingSec,
      });

      return {
        status: "duplicate_suppressed",
        message: dupe.reason,
      };
    }
  }

  const desc = parseSourceDescriptor(stream);
  if (
    !stream.isDemo &&
    (desc.scheme === "none" ||
      desc.scheme === "twitch-chat" ||
      desc.scheme === "youtube-chat")
  ) {
    throw new Error(
      `This ${stream.platform.toUpperCase()} broadcast restricts public video segments (subscriber-only or age-gated). Try another public live stream.`
    );
  }

  const jobId = `job-${crypto.randomUUID().slice(0, 8)}`;
  const clipId = `clip-${crypto.randomUUID().slice(0, 10)}`;
  const timeStamp = new Date().toTimeString().slice(0, 5);
  const clipTitle =
    params.scenario === "music_record"
      ? `Expressway Overtime Drift Record (${timeStamp})`
      : params.scenario === "clutch"
      ? `1v5 Site Retake Clutch Surge (${timeStamp})`
      : params.scenario === "live_chat_spike"
      ? `${stream.channelName} — Live Chat Surge Highlight (${timeStamp})`
      : params.scenario === "authorized_auto"
      ? `${stream.channelName} — Auto-Detected Peak Highlight`
      : `${stream.channelName} — Live ${stream.gameName} Clip (${timeStamp})`;

  if (session) {
    session.isCapturing = true;
    session.captureState = "capturing_post";
    session.videoMotionScore = 92;
    session.audioPeakDb = -4.8;
    session.combinedExcitement = 93;
    broadcastWs("buffer_tick", serializeSessionBuffer(session, stream));
  }

  // Stamp last_clip_event_at immediately so overlapping spikes get deduplicated
  const eventAtIso = new Date().toISOString();
  db.prepare("UPDATE streams SET last_clip_event_at = ? WHERE id = ?").run(
    eventAtIso,
    stream.id
  );

  upsertJob({
    id: jobId,
    clipId,
    streamId: stream.id,
    title: clipTitle,
    type: "auto_capture",
    stage: `Locking 20s live pre-buffer + recording ${postBufferSec}s post-event...`,
    progress: 16,
    status: "running",
    isDemo: stream.isDemo,
    updatedAt: new Date().toISOString(),
  });

  let oneShotRing: LiveHlsRingBuffer | null = null;

  try {
    const outFileName = `${clipId}.mp4`;
    const outPosterName = `${clipId}.jpg`;
    const outMp4Path = path.join(
      process.cwd(),
      "public",
      "media",
      "generated",
      outFileName
    );
    const outPosterPath = path.join(
      process.cwd(),
      "public",
      "media",
      "generated",
      outPosterName
    );

    const activeQuality =
      stream.videoQuality || settings.videoQuality || "1080p_source";
    const qualityTag =
      activeQuality === "720p_balanced" ? "720p60 HD" : "1080p60 Full HD";

    const onCaptureProgress = (pct: number) => {
      if (session && pct >= 60) session.captureState = "encoding";
      upsertJob({
        id: jobId,
        clipId,
        streamId: stream.id,
        title: clipTitle,
        type: "auto_capture",
        stage:
          pct < 60
            ? `Capturing live 20s pre-buffer + ${postBufferSec}s post-event (${pct}%)...`
            : `Finalizing ${qualityTag} H.264/AAC Original MP4 (${pct}%)...`,
        progress: Math.round(15 + pct * 0.65),
        status: "running",
        isDemo: stream.isDemo,
        updatedAt: new Date().toISOString(),
      });
    };

    let encoded: {
      durationSeconds: number;
      actualPreBufferSec: number;
      actualPostBufferSec: number;
      width: number;
      height: number;
      fileSizeBytes: number;
    };

    const eventTimeSec =
      params.customEventTimeSec !== undefined
        ? params.customEventTimeSec
        : stream.isDemo
        ? params.scenario === "music_record"
          ? 48.0
          : 20.0
        : session
        ? Math.max(20, session.streamClockSec)
        : 20.0;

    // 2. Capture from Real Live Stream (Twitch / YouTube / Kick / HLS — 1080p60 Source!) or Local File
    if (!stream.isDemo && session?.hlsRing) {
      encoded = await session.hlsRing.captureClip({
        preBufferSec: 20,
        postBufferSec,
        outputMp4Path: outMp4Path,
        outputPosterPath: outPosterPath,
        quality: activeQuality,
        onProgress: onCaptureProgress,
      });
    } else if (
      !stream.isDemo &&
      (desc.scheme === "twitch-live" ||
        desc.scheme === "kick-live" ||
        desc.scheme === "hls-url" ||
        desc.scheme === "youtube-hls")
    ) {
      // One-shot instant 20s+post capture directly from the live HLS window even before clicking Start!
      let variant: string | null = null;
      if (desc.scheme === "twitch-live") {
        variant = await fetchTwitchHlsVariant(desc.target, activeQuality);
      } else if (desc.scheme === "kick-live") {
        variant =
          desc.query.get("hls") ||
          (await resolveKickLive(desc.target, activeQuality)).hlsVariantUrl ||
          null;
      } else if (desc.scheme === "youtube-hls") {
        variant =
          (await resolveYoutubeLive(desc.target, activeQuality)).hlsVariantUrl ||
          null;
      } else {
        variant = desc.target;
      }

      if (!variant && desc.scheme === "youtube-hls") {
        encoded = await captureYoutubeLiveDvrClip({
          videoId: desc.target,
          preBufferSec: 20,
          postBufferSec,
          outputMp4Path: outMp4Path,
          outputPosterPath: outPosterPath,
          quality: activeQuality,
          onProgress: onCaptureProgress,
        });
      } else {
        if (!variant) {
          throw new Error(
            `Live stream "${stream.channelName}" is currently offline or unavailable.`
          );
        }
        oneShotRing = new LiveHlsRingBuffer({
          streamId: stream.id,
          variantUrl: variant,
        });
        await oneShotRing.pollOnce();
        encoded = await oneShotRing.captureClip({
          preBufferSec: 20,
          postBufferSec,
          outputMp4Path: outMp4Path,
          outputPosterPath: outPosterPath,
          quality: activeQuality,
          onProgress: onCaptureProgress,
        });
      }
    } else if (!stream.isDemo && desc.scheme === "youtube-live") {
      encoded = await captureYoutubeLiveDvrClip({
        videoId: desc.target,
        preBufferSec: 20,
        postBufferSec,
        outputMp4Path: outMp4Path,
        outputPosterPath: outPosterPath,
        quality: activeQuality,
        onProgress: onCaptureProgress,
      });
    } else {
      const fileSource =
        stream.localSourcePath ||
        (stream.platform === "hls" ? stream.streamUrl : null);
      if (!fileSource) {
        throw new Error("No playable stream source found for capture.");
      }
      encoded = await captureRollingBufferClip({
        sourcePathOrUrl: fileSource,
        eventTimeSec,
        preBufferSec: 20,
        postBufferSec,
        outputMp4Path: outMp4Path,
        outputPosterPath: outPosterPath,
        quality: activeQuality,
        onProgress: onCaptureProgress,
      });
    }

    // 3. Real AI 0–100 Multi-Signal Scoring + Real FFmpeg Audio & Copyright Analysis
    if (session) session.captureState = "scoring";
    upsertJob({
      id: jobId,
      clipId,
      streamId: stream.id,
      title: clipTitle,
      type: "auto_capture",
      stage: "Running AI 0–100 scoring & non-destructive music detection...",
      progress: 86,
      status: "running",
      isDemo: stream.isDemo,
      updatedAt: new Date().toISOString(),
    });

    // Measure genuine audio reaction dB spike inside the captured live clip!
    let livePeakDb = params.customPeakDeltaDb ?? 15.5;
    let liveMotion = params.customMotionScore ?? 82;
    if (!stream.isDemo) {
      try {
        const audioPeak = await detectPeakMomentInVideo(outMp4Path);
        livePeakDb = audioPeak.peakDeltaDb;
        liveMotion = audioPeak.motionScore;
      } catch {
        // fallback defaults
      }
    }

    const scoringInput: ScoringSignals =
      params.scenario === "music_record"
        ? {
            chatRatePerMin: peakRate,
            baselineChatRatePerMin: baselineRate,
            hypeKeywordDensity: 0.78,
            videoMotionIntensity: 88,
            audioPeakDeltaDb: 18.2,
            eventTier: "record_finish",
            viewerRetentionRatio: 1.55,
            triggerLabel: "Expressway drift record finish",
          }
        : params.scenario === "clutch"
        ? {
            chatRatePerMin: peakRate,
            baselineChatRatePerMin: baselineRate,
            hypeKeywordDensity: 0.92,
            videoMotionIntensity: 94,
            audioPeakDeltaDb: 22.6,
            eventTier: "clutch_ace",
            viewerRetentionRatio: 1.82,
            triggerLabel: "1v5 tactical site retake clutch",
          }
        : params.scenario === "live_chat_spike"
        ? {
            chatRatePerMin: Math.max(peakRate, 48),
            baselineChatRatePerMin: baselineRate,
            hypeKeywordDensity: Math.min(
              0.95,
              0.45 + topKeywords.length * 0.12
            ),
            videoMotionIntensity: Math.max(82, liveMotion),
            audioPeakDeltaDb: livePeakDb,
            eventTier: "victory_wipe",
            viewerRetentionRatio: stream.viewerCount > 1000 ? 1.7 : 1.45,
            triggerLabel: `Live ${stream.platform.toUpperCase()} chat surge on ${
              stream.channelName
            }`,
          }
        : !stream.isDemo
        ? {
            chatRatePerMin: peakRate || 32,
            baselineChatRatePerMin: baselineRate || 22,
            hypeKeywordDensity: Math.min(0.85, 0.38 + topKeywords.length * 0.1),
            videoMotionIntensity: liveMotion,
            audioPeakDeltaDb: livePeakDb,
            eventTier:
              params.scenario === "authorized_auto"
                ? "audio_motion_peak"
                : "manual_buffer",
            viewerRetentionRatio: stream.viewerCount > 500 ? 1.52 : 1.35,
            triggerLabel: `Live ${stream.platform.toUpperCase()} capture from ${
              stream.channelName
            }`,
          }
        : {
            chatRatePerMin: peakRate,
            baselineChatRatePerMin: baselineRate || 25,
            hypeKeywordDensity: 0.52,
            videoMotionIntensity: 80,
            audioPeakDeltaDb: 14.2,
            eventTier: "manual_buffer",
            viewerRetentionRatio: 1.32,
            triggerLabel: "20s rolling buffer instant capture",
          };

    const { scores, summary } = computeAiClipScore(scoringInput);

    // Non-destructive music/copyright detection (NEVER alters or removes audio)
    const music = settings.musicDetectionEnabled
      ? await analyzeMusicCopyright(outMp4Path)
      : {
          flagged: false,
          confidence: 0,
          trackMatch: "",
          details:
            "Music scan skipped per user settings. Audio preserved untouched.",
          rmsDb: -40,
          crestFactor: 20,
          audioModified: false,
        };

    const gameName =
      params.scenario === "music_record" ? "Velocity Zero" : stream.gameName;

    const triggerReason = stream.isDemo
      ? params.scenario === "manual"
        ? `Rolling buffer save (20s pre + ${encoded.actualPostBufferSec}s post)`
        : `Chat surged ${(peakRate / baselineRate).toFixed(1)}x (${topKeywords
            .slice(0, 3)
            .join(", ")}) + gameplay event`
      : params.scenario === "live_chat_spike"
      ? `Live ${stream.platform.toUpperCase()} chat surged ${(
          peakRate / Math.max(10, baselineRate)
        ).toFixed(1)}x${
          topKeywords.length ? ` (${topKeywords.slice(0, 3).join(", ")})` : ""
        } · ${encoded.actualPreBufferSec}s pre + ${encoded.actualPostBufferSec}s post`
      : stream.platform === "upload"
      ? `FFmpeg audio/motion peak (+${livePeakDb} dB) · ${encoded.actualPreBufferSec}s pre + ${encoded.actualPostBufferSec}s post`
      : `Live ${stream.platform.toUpperCase()} buffer (${encoded.actualPreBufferSec}s pre + ${encoded.actualPostBufferSec}s post · +${livePeakDb} dB peak${
          peakRate > 0 ? ` · ${peakRate} msg/min` : ""
        })`;

    const autoSubs = generateSmartSubtitles({
      durationSeconds: encoded.durationSeconds,
      preBufferSeconds: encoded.actualPreBufferSec,
      gameName,
      triggerReason,
    });

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
        ?, ?, ?, null, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, '16:9', ?, ?, ?, 'ready',
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, 0, '',
        ?, 0, ?, ?, ?
      )`
    ).run(
      clipId,
      params.userId,
      stream.id,
      clipTitle,
      gameName,
      stream.channelName,
      stream.platform,
      `/api/media/generated/${outFileName}`,
      `/api/media/generated/${outPosterName}`,
      outMp4Path,
      outPosterPath,
      encoded.durationSeconds,
      encoded.actualPreBufferSec,
      encoded.actualPostBufferSec,
      encoded.width,
      encoded.height,
      encoded.fileSizeBytes,
      scores.total,
      scores.chatActivity,
      scores.gameplayMoments,
      scores.suddenReactions,
      scores.inGameEvents,
      scores.viewerEngagement,
      triggerReason,
      summary,
      music.flagged ? 1 : 0,
      music.confidence,
      music.trackMatch,
      music.details,
      music.rmsDb,
      music.crestFactor,
      JSON.stringify(autoSubs),
      stream.isDemo ? 1 : 0,
      stream.isAuthorized || stream.isDemo ? 1 : 0,
      new Date().toISOString()
    );

    if (
      peakRate > 0 &&
      (stream.isDemo ||
        params.scenario === "live_chat_spike" ||
        peakRate >= baselineRate * 1.5)
    ) {
      const surgeId = `surge-${crypto.randomUUID().slice(0, 10)}`;
      const mult = Number((peakRate / Math.max(10, baselineRate)).toFixed(2));
      db.prepare(
        `INSERT INTO chat_surges (
          id, stream_id, clip_id, channel_name, peak_rate_per_min, baseline_rate_per_min,
          multiplier, top_keywords, outcome, outcome_note, is_demo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clip_generated', ?, ?, ?)`
      ).run(
        surgeId,
        stream.id,
        clipId,
        stream.channelName,
        peakRate,
        baselineRate,
        mult,
        (topKeywords.length ? topKeywords : ["LIVE CLIP"]).join(","),
        `Saved ${encoded.actualPreBufferSec}s pre + ${encoded.actualPostBufferSec}s post (AI Score ${scores.total}/100${
          music.flagged ? " · Music Flagged" : ""
        })`,
        stream.isDemo ? 1 : 0,
        new Date().toISOString()
      );
      const surgeRec = mapSurgeRow(
        db
          .prepare("SELECT * FROM chat_surges WHERE id = ?")
          .get(surgeId) as Record<string, unknown>
      );
      broadcastWs("chat_surge", surgeRec);
    }

    const clipRow = mapClipRow(
      db.prepare("SELECT * FROM clips WHERE id = ?").get(clipId) as Record<
        string,
        unknown
      >
    );
    const publicClip = stripInternalClipPaths(clipRow);
    broadcastWs("clip_created", publicClip);

    // 4. AUTO-GENERATE PAIRED 9:16 VERTICAL SHORT (while keeping Original 16:9 untouched!)
    const shouldCreateShort =
      params.createShortOverride !== undefined
        ? params.createShortOverride
        : stream.autoShortsEnabled;

    let publicShortClip: ClipRecord | null = null;
    let shortRowFull: ReturnType<typeof mapClipRow> | null = null;

    if (shouldCreateShort) {
      const shortId = `clip-short-${crypto.randomUUID().slice(0, 8)}`;
      const shortFileName = `${shortId}.mp4`;
      const shortPosterName = `${shortId}.jpg`;
      const shortMp4Path = path.join(
        process.cwd(),
        "public",
        "media",
        "generated",
        shortFileName
      );
      const shortPosterPath = path.join(
        process.cwd(),
        "public",
        "media",
        "generated",
        shortPosterName
      );

      // Build crisp headline caption from top hype keyword or streamer + game
      const headlineBadge = topKeywords[0]
        ? `${topKeywords[0]} · ${stream.channelName.toUpperCase()}`
        : `${stream.channelName.toUpperCase()} · ${gameName.toUpperCase()}`;
      const autoCaption: CaptionConfig | null = settings.autoShortsCaption
        ? {
            text: headlineBadge.slice(0, 38),
            position: "top",
            style: "blue",
            fontSize: "md",
          }
        : null;

      const activeShortsLayout =
        stream.shortsLayout || settings.shortsLayout || "fit_blur";
      const shortResTag =
        activeQuality === "720p_balanced" ? "720×1280" : "1080×1920 Full HD";
      const layoutLabel =
        activeShortsLayout === "fit_blur"
          ? "Full-Frame"
          : activeShortsLayout === "split_cam"
          ? "Split-Cam"
          : "Full-Zoom";

      upsertJob({
        id: jobId,
        clipId: shortId,
        streamId: stream.id,
        title: `${clipTitle} [9:16 Short]`,
        type: "auto_capture",
        stage: `Original ${encoded.width}×${encoded.height} saved! Rendering full-length ${shortResTag} ${layoutLabel} 9:16 Short (${encoded.durationSeconds}s)...`,
        progress: 90,
        status: "running",
        isDemo: stream.isDemo,
        updatedAt: new Date().toISOString(),
      });

      try {
        const shortRendered = await renderEditedClip({
          inputPath: outMp4Path,
          outputMp4Path: shortMp4Path,
          outputPosterPath: shortPosterPath,
          startTime: 0,
          endTime: encoded.durationSeconds,
          fullLength: true, // Cover 100% exact start-to-end duration of the Original clip!
          aspectRatio: "9:16",
          shortsLayout: activeShortsLayout,
          quality: activeQuality,
          cropOffsetX: 0,
          caption: autoCaption,
          subtitles: settings.autoShortsCaption ? autoSubs : [],
          userPermittedMuteAudio: false, // Never auto-mute original audio!
        });

        const shortTitle = `${stream.channelName} — ${gameName} [9:16 Short] (${timeStamp})`;
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
            ?, '9:16', ?, ?, ?, 'ready',
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, 0, ?,
            ?, 1, ?, ?, ?
          )`
        ).run(
          shortId,
          params.userId,
          stream.id,
          clipId,
          shortTitle,
          gameName,
          stream.channelName,
          stream.platform,
          `/api/media/generated/${shortFileName}`,
          `/api/media/generated/${shortPosterName}`,
          shortMp4Path,
          shortPosterPath,
          shortRendered.durationSeconds,
          encoded.actualPreBufferSec,
          encoded.actualPostBufferSec,
          shortRendered.width,
          shortRendered.height,
          shortRendered.fileSizeBytes,
          scores.total,
          scores.chatActivity,
          scores.gameplayMoments,
          scores.suddenReactions,
          scores.inGameEvents,
          scores.viewerEngagement,
          `Auto 9:16 Short paired with Original (${encoded.actualPreBufferSec}s pre + ${encoded.actualPostBufferSec}s post)`,
          summary,
          music.flagged ? 1 : 0,
          music.confidence,
          music.trackMatch,
          music.details,
          music.rmsDb,
          music.crestFactor,
          autoCaption ? JSON.stringify(autoCaption) : "",
          JSON.stringify(settings.autoShortsCaption ? autoSubs : []),
          stream.isDemo ? 1 : 0,
          stream.isAuthorized || stream.isDemo ? 1 : 0,
          new Date().toISOString()
        );

        shortRowFull = mapClipRow(
          db.prepare("SELECT * FROM clips WHERE id = ?").get(shortId) as Record<
            string,
            unknown
          >
        );
        publicShortClip = stripInternalClipPaths(shortRowFull);
        broadcastWs("clip_created", publicShortClip);
      } catch {
        // Keep Original 16:9 intact even if Short render hits an issue
      }
    }

    // 5. AUTO-SAVE TO `exports/` & AUTO-DOWNLOAD BOTH (Original 16:9 + 9:16 Short)
    //    If copyrighted music is detected, PAUSE auto-download & warn user first!
    const shouldAutoDownload =
      (params.autoDownloadOverride !== undefined
        ? params.autoDownloadOverride
        : stream.autoDownloadEnabled) &&
      (stream.isAuthorized || stream.isDemo);

    let exportFiles: string[] = [];
    let autoDownloadStatus: "ready" | "copyright_hold" | "off" = "off";
    const hypeVal = Math.round(
      params.triggerHypeScore ??
        session?.combinedExcitement ??
        scores.total
    );

    if (shouldAutoDownload) {
      const musicHold = music.flagged && settings.warnBeforeCopyrightExport;

      if (musicHold) {
        autoDownloadStatus = "copyright_hold";
        const holdEvt: AutoDownloadBundleEvent = {
          bundleId: `bundle-${crypto.randomUUID().slice(0, 8)}`,
          status: "copyright_hold",
          streamId: stream.id,
          channelName: stream.channelName,
          triggerType:
            params.scenario === "manual" ? "manual" : "hype_auto",
          hypeScore: hypeVal,
          originalClip: publicClip,
          shortClip: publicShortClip,
          exportFiles: [],
        };
        broadcastWs("auto_download_bundle", holdEvt);
      } else {
        exportFiles = savePairAndLogDownloads({
          original: clipRow,
          short: shortRowFull,
          userId: params.userId,
          ackCopyright: false,
        });
        autoDownloadStatus = "ready";

        const readyEvt: AutoDownloadBundleEvent = {
          bundleId: `bundle-${crypto.randomUUID().slice(0, 8)}`,
          status: "ready",
          streamId: stream.id,
          channelName: stream.channelName,
          triggerType:
            params.scenario === "manual" ? "manual" : "hype_auto",
          hypeScore: hypeVal,
          originalClip: publicClip,
          shortClip: publicShortClip,
          exportFiles,
        };
        broadcastWs("auto_download_bundle", readyEvt);
      }
    }

    upsertJob({
      id: jobId,
      clipId,
      streamId: stream.id,
      title: clipTitle,
      type: "auto_capture",
      stage: publicShortClip
        ? autoDownloadStatus === "ready"
          ? `Saved Original 16:9 + 9:16 Short · Auto-exported (${scores.total}/100)`
          : autoDownloadStatus === "copyright_hold"
          ? `Saved Original 16:9 + 9:16 Short · Music warning before download`
          : `Saved Original 16:9 + 9:16 Short · AI Score ${scores.total}/100`
        : `Ready · ${encoded.durationSeconds}s MP4 · AI Score ${scores.total}/100`,
      progress: 100,
      status: "completed",
      isDemo: stream.isDemo,
      updatedAt: new Date().toISOString(),
    });

    return {
      status: "created",
      clip: publicClip,
      shortClip: publicShortClip,
      exportFiles,
      autoDownloadStatus,
      message: publicShortClip
        ? autoDownloadStatus === "copyright_hold"
          ? `Saved BOTH Original (16:9) & Short (9:16) — Music warning triggered; confirm to download both (audio untouched).`
          : autoDownloadStatus === "ready"
          ? `Saved & auto-downloaded BOTH Original (16:9) & Short (9:16) MP4s (AI ${scores.total}/100)!`
          : `Saved BOTH Original (16:9) & Short (9:16) MP4s (AI ${scores.total}/100).`
        : `Captured live clip "${clipTitle}" (${encoded.durationSeconds}s MP4 · AI Score ${scores.total}/100).`,
    };
  } catch (err) {
    const errMsg =
      err instanceof Error ? err.message : "Clip generation failed.";
    upsertJob({
      id: jobId,
      clipId,
      streamId: stream.id,
      title: clipTitle,
      type: "auto_capture",
      stage: "Capture failed",
      progress: 100,
      status: "failed",
      error: errMsg,
      isDemo: stream.isDemo,
      updatedAt: new Date().toISOString(),
    });
    throw new Error(errMsg);
  } finally {
    if (oneShotRing) {
      oneShotRing.stop();
    }
    if (session) {
      session.isCapturing = false;
      session.captureState = "idle";
    }
  }
}

function savePairAndLogDownloads(params: {
  original: ReturnType<typeof mapClipRow>;
  short: ReturnType<typeof mapClipRow> | null;
  userId: string | null;
  ackCopyright: boolean;
}): string[] {
  const db = getDb();
  const groupStamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:]/g, "-");
  const savedPaths: string[] = [];

  const origExport = saveClipToExportsFolder({
    sourceFilePath: params.original.filePath,
    channelName: params.original.channelName,
    gameName: params.original.gameName,
    variant: "original",
    groupStamp,
  });
  if (origExport) {
    savedPaths.push(origExport.relativePath);
    db.prepare(
      `INSERT INTO clip_downloads (
        id, clip_id, user_id, clip_title, format, aspect_ratio,
        file_size_bytes, copyright_acknowledged, saved_export_path, is_demo, downloaded_at
      ) VALUES (?, ?, ?, ?, 'mp4', ?, ?, ?, ?, ?, ?)`
    ).run(
      `dl-${crypto.randomUUID().slice(0, 10)}`,
      params.original.id,
      params.userId,
      params.original.title,
      params.original.aspectRatio,
      params.original.fileSizeBytes,
      params.ackCopyright ? 1 : 0,
      origExport.relativePath,
      params.original.isDemo ? 1 : 0,
      new Date().toISOString()
    );
  }

  if (params.short) {
    const shortExport = saveClipToExportsFolder({
      sourceFilePath: params.short.filePath,
      channelName: params.short.channelName,
      gameName: params.short.gameName,
      variant: "short_9x16",
      groupStamp,
    });
    if (shortExport) {
      savedPaths.push(shortExport.relativePath);
      db.prepare(
        `INSERT INTO clip_downloads (
          id, clip_id, user_id, clip_title, format, aspect_ratio,
          file_size_bytes, copyright_acknowledged, saved_export_path, is_demo, downloaded_at
        ) VALUES (?, ?, ?, ?, 'mp4', ?, ?, ?, ?, ?, ?)`
      ).run(
        `dl-${crypto.randomUUID().slice(0, 10)}`,
        params.short.id,
        params.userId,
        params.short.title,
        params.short.aspectRatio,
        params.short.fileSizeBytes,
        params.ackCopyright ? 1 : 0,
        shortExport.relativePath,
        params.short.isDemo ? 1 : 0,
        new Date().toISOString()
      );
    }
  }

  return savedPaths;
}

/**
 * Save & log BOTH an Original 16:9 clip and its paired 9:16 Short into `clipx-ai/exports/`
 * (used when the user clicks "Download Both" or confirms export after a copyrighted music warning).
 */
export function exportClipPairToDisk(params: {
  clipId: string;
  userId: string | null;
  ackCopyright: boolean;
}):
  | {
      status: "ok";
      originalClip: ClipRecord;
      shortClip: ClipRecord | null;
      exportFiles: string[];
    }
  | { status: "not_found"; error: string }
  | { status: "forbidden"; error: string }
  | {
      status: "copyright_warning";
      originalClip: ClipRecord;
      shortClip: ClipRecord | null;
      error: string;
    } {
  const db = getDb();
  const rawRow = db
    .prepare(
      "SELECT * FROM clips WHERE id = ? AND (user_id IS NULL OR user_id = ?)"
    )
    .get(params.clipId, params.userId ?? "__guest__") as
    | Record<string, unknown>
    | undefined;
  if (!rawRow) {
    return { status: "not_found", error: "Clip not found." };
  }

  const target = mapClipRow(rawRow);
  let original = target;
  let short: ReturnType<typeof mapClipRow> | null = null;

  if (target.parentClipId) {
    const parentRaw = db
      .prepare("SELECT * FROM clips WHERE id = ?")
      .get(target.parentClipId) as Record<string, unknown> | undefined;
    if (parentRaw) {
      original = mapClipRow(parentRaw);
      short = target;
    }
  } else {
    const childRaw = db
      .prepare(
        "SELECT * FROM clips WHERE parent_clip_id = ? AND aspect_ratio = '9:16' ORDER BY created_at DESC LIMIT 1"
      )
      .get(target.id) as Record<string, unknown> | undefined;
    if (childRaw) {
      short = mapClipRow(childRaw);
    }
  }

  if (!original.ownerAuthorized && !original.isDemo) {
    return {
      status: "forbidden",
      error:
        "Download blocked: confirm creator clipping permission on this stream before exporting.",
    };
  }

  const settings = getEffectiveSettings(params.userId);
  const flagged =
    original.music.flagged || Boolean(short?.music.flagged);

  if (flagged && settings.warnBeforeCopyrightExport && !params.ackCopyright) {
    return {
      status: "copyright_warning",
      originalClip: stripInternalClipPaths(original),
      shortClip: short ? stripInternalClipPaths(short) : null,
      error:
        "Potential copyrighted music detected. Confirm acknowledgment before downloading both files — CLIPX AI has NOT modified the original audio.",
    };
  }

  const exportFiles = savePairAndLogDownloads({
    original,
    short,
    userId: params.userId,
    ackCopyright: params.ackCopyright,
  });

  return {
    status: "ok",
    originalClip: stripInternalClipPaths(original),
    shortClip: short ? stripInternalClipPaths(short) : null,
    exportFiles,
  };
}

