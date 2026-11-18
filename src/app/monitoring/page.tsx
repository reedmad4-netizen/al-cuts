"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  Compass,
  CopyX,
  Download,
  ExternalLink,
  Eye,
  Flame,
  Link2,
  Loader2,
  MessageSquare,
  MonitorPlay,
  Music,
  Play,
  Radio,
  RefreshCw,
  Search,
  Smartphone,
  Square,
  Trash2,
  Upload,
  Users,
  Zap,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { SourceBadge, StreamStatusBadge } from "@/components/Badges";
import { StudioShell } from "@/components/StudioShell";
import { platformLabel } from "@/lib/format";
import type {
  ClipRecord,
  DiscoveredLiveStream,
  LiveBufferState,
  ShortsLayout,
  StreamPlatform,
  StreamRecord,
  VideoQuality,
} from "@/lib/types";

const GAME_FILTERS = [
  { label: "Top Live", query: "" },
  { label: "VALORANT", query: "VALORANT" },
  { label: "Counter-Strike", query: "Counter-Strike" },
  { label: "Fortnite", query: "Fortnite" },
  { label: "League of Legends", query: "League of Legends" },
  { label: "Apex Legends", query: "Apex Legends" },
  { label: "GTA V", query: "Grand Theft Auto V" },
  { label: "Minecraft", query: "Minecraft" },
];

function getLiveEmbedUrl(stream: StreamRecord, host: string): string | null {
  if (!host) return null;
  if (stream.platform === "twitch") {
    const login =
      stream.localSourcePath
        ?.replace(/^twitch-(live|chat):\/\//, "")
        .split("?")[0] ||
      stream.streamUrl.split("/").filter(Boolean).pop() ||
      stream.channelName.toLowerCase();
    return `https://player.twitch.tv/?channel=${encodeURIComponent(
      login
    )}&parent=${encodeURIComponent(host)}&muted=true&autoplay=true`;
  }
  if (stream.platform === "youtube") {
    const vid =
      stream.localSourcePath
        ?.replace(/^youtube-(live|hls|chat):\/\//, "")
        .split("?")[0] ||
      (() => {
        try {
          return new URL(stream.streamUrl).searchParams.get("v") || "";
        } catch {
          return "";
        }
      })();
    if (/^[a-zA-Z0-9_-]{11}$/.test(vid)) {
      return `https://www.youtube.com/embed/${encodeURIComponent(
        vid
      )}?autoplay=1&mute=1&playsinline=1`;
    }
  }
  if (stream.platform === "kick") {
    const slug =
      stream.localSourcePath
        ?.replace(/^kick-live:\/\//, "")
        .split("?")[0] ||
      stream.streamUrl.split("/").filter(Boolean).pop() ||
      stream.channelName.toLowerCase();
    return `https://player.kick.com/${encodeURIComponent(
      slug
    )}?autoplay=true&muted=true`;
  }
  return null;
}

export default function MonitoringPage() {
  const { notify, subscribeWs, requestDownloadPair } = useApp();
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [buffers, setBuffers] = useState<Record<string, LiveBufferState>>({});
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [lastClip, setLastClip] = useState<ClipRecord | null>(null);
  const [lastShortClip, setLastShortClip] = useState<ClipRecord | null>(null);
  const [lastExportFiles, setLastExportFiles] = useState<string[]>([]);
  const [showLiveEmbed, setShowLiveEmbed] = useState(false);
  const [pageHost, setPageHost] = useState("");
  const [thumbNonce, setThumbNonce] = useState(0);

  // Connect Any Live Stream (Zero API Key) form state
  const [connectTab, setConnectTab] = useState<"url" | "upload">("url");
  const [streamUrl, setStreamUrl] = useState("");
  const [platform, setPlatform] = useState<StreamPlatform>("twitch");
  const [gameName, setGameName] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectingCardUrl, setConnectingCardUrl] = useState<string | null>(
    null
  );

  // Live Stream Discovery browser (0 API keys!)
  const [discoverCategory, setDiscoverCategory] = useState("");
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredLiveStream[]>([]);
  const [loadingDiscover, setLoadingDiscover] = useState(false);

  // Per-stream buffer, 1080p60 quality & full-length Shorts controls
  const [postBufferDraft, setPostBufferDraft] = useState(8);
  const [cooldownDraft, setCooldownDraft] = useState(25);
  const [minScoreDraft, setMinScoreDraft] = useState(65);
  const [hypeThresholdDraft, setHypeThresholdDraft] = useState(70);
  const [videoQualityDraft, setVideoQualityDraft] =
    useState<VideoQuality>("1080p_source");
  const [shortsLayoutDraft, setShortsLayoutDraft] =
    useState<ShortsLayout>("fit_blur");
  const [autoShortsDraft, setAutoShortsDraft] = useState(true);
  const [autoDownloadDraft, setAutoDownloadDraft] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setPageHost(window.location.hostname);
    }
    const iv = setInterval(() => setThumbNonce((n) => n + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  const loadStreams = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list: StreamRecord[] = data.streams || [];
      setStreams(list);
      setBuffers(data.buffers || {});
      setSelectedId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        const liveReal = list.find(
          (s) => !s.isDemo && s.status === "monitoring"
        );
        return liveReal?.id || list[0]?.id || "stream-demo-sandbox";
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDiscover = useCallback(async (q: string) => {
    setLoadingDiscover(true);
    try {
      const res = await fetch(
        `/api/streams/discover?q=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      setDiscovered(data.streams || []);
    } finally {
      setLoadingDiscover(false);
    }
  }, []);

  useEffect(() => {
    void loadStreams();
  }, [loadStreams]);

  useEffect(() => {
    void loadDiscover(discoverCategory);
  }, [discoverCategory, loadDiscover]);

  useEffect(() => {
    return subscribeWs((event, payload) => {
      if (event === "buffer_tick" && payload) {
        const b = payload as LiveBufferState;
        setBuffers((prev) => ({ ...prev, [b.streamId]: b }));
      } else if (event === "buffer_stopped" && payload) {
        const { streamId } = payload as { streamId: string };
        setBuffers((prev) => {
          const copy = { ...prev };
          delete copy[streamId];
          return copy;
        });
      } else if (event === "stream_updated" && payload) {
        const s = payload as StreamRecord;
        setStreams((prev) => prev.map((x) => (x.id === s.id ? s : x)));
      } else if (event === "clip_created" && payload) {
        const c = payload as ClipRecord;
        if (!c.isEdited) {
          setLastClip(c);
          setLastShortClip(null);
          setLastExportFiles([]);
        } else if (c.parentClipId && c.aspectRatio === "9:16") {
          setLastShortClip(c);
        }
      } else if (event === "auto_download_bundle" && payload) {
        const b = payload as {
          originalClip: ClipRecord;
          shortClip?: ClipRecord | null;
          exportFiles?: string[];
        };
        if (b.originalClip) setLastClip(b.originalClip);
        if (b.shortClip !== undefined) setLastShortClip(b.shortClip || null);
        if (b.exportFiles) setLastExportFiles(b.exportFiles);
      }
    });
  }, [subscribeWs]);

  const activeStream =
    streams.find((s) => s.id === selectedId) || streams[0] || null;
  const activeBuffer = activeStream ? buffers[activeStream.id] : undefined;

  useEffect(() => {
    setShowLiveEmbed(false);
    if (activeStream) {
      setPostBufferDraft(activeStream.postBufferSeconds);
      setCooldownDraft(activeStream.dedupeCooldownSeconds);
      setMinScoreDraft(activeStream.minAiScore);
      setHypeThresholdDraft(activeStream.hypeThreshold ?? 70);
      setVideoQualityDraft(activeStream.videoQuality ?? "1080p_source");
      setShortsLayoutDraft(activeStream.shortsLayout ?? "fit_blur");
      setAutoShortsDraft(activeStream.autoShortsEnabled ?? true);
      setAutoDownloadDraft(activeStream.autoDownloadEnabled ?? true);
    }
  }, [activeStream?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function connectLiveUrl(opts: {
    url: string;
    plat?: StreamPlatform;
    title?: string;
    game?: string;
    authorized?: boolean;
  }) {
    const res = await fetch("/api/streams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        streamUrl: opts.url,
        platform: opts.plat,
        title: opts.title || undefined,
        gameName: opts.game || undefined,
        isAuthorized: opts.authorized ?? isAuthorized,
        autoStart: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to connect stream.");

    const added = data.stream as StreamRecord;
    setStreams((prev) => {
      const rest = prev.filter((x) => x.id !== added.id);
      return [added, ...rest];
    });
    if (data.buffer) {
      setBuffers((prev) => ({ ...prev, [added.id]: data.buffer }));
    }
    setSelectedId(added.id);

    if (added.status === "monitoring" || added.status === "ready") {
      notify({
        type: "success",
        title: `Connected Live: ${added.channelName}`,
        description: `20s live rolling buffer & real-time ${platformLabel(
          added.platform
        )} chat active — no API key needed.`,
      });
    } else if (added.status === "offline") {
      notify({
        type: "info",
        title: `${added.channelName} is Offline`,
        description: added.statusReason,
      });
    } else {
      notify({
        type: "warning",
        title: `${added.channelName} — ${added.status}`,
        description: added.statusReason,
      });
    }
  }

  async function handleConnectUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!streamUrl.trim()) return;
    setConnecting(true);
    try {
      await connectLiveUrl({
        url: streamUrl,
        plat: platform,
        title: customTitle,
        game: gameName,
        authorized: isAuthorized,
      });
      setStreamUrl("");
      setCustomTitle("");
      setGameName("");
    } catch (err) {
      notify({
        type: "error",
        title: "Could not connect stream",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleQuickConnect(item: DiscoveredLiveStream) {
    setConnectingCardUrl(item.streamUrl);
    try {
      await connectLiveUrl({
        url: item.streamUrl,
        plat: item.platform,
        authorized: isAuthorized,
      });
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      notify({
        type: "error",
        title: "Could not connect live stream",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setConnectingCardUrl(null);
    }
  }

  async function handleUploadIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) {
      notify({
        type: "warning",
        title: "Choose a Video File",
        description: "Select an MP4, WebM, or MOV gameplay recording.",
      });
      return;
    }
    setConnecting(true);
    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("title", customTitle);
      fd.append("gameName", gameName || "Gameplay");
      fd.append("isAuthorized", isAuthorized ? "true" : "false");
      fd.append("autoStart", "true");

      const res = await fetch("/api/streams/upload", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");

      const added = data.stream as StreamRecord;
      setStreams((prev) => [added, ...prev]);
      if (data.buffer) {
        setBuffers((prev) => ({ ...prev, [added.id]: data.buffer }));
      }
      setSelectedId(added.id);
      setUploadFile(null);
      setCustomTitle("");
      setGameName("");
      notify({
        type: "success",
        title: "Gameplay Recording Monitoring Started",
        description:
          "FFmpeg is buffering 20s segments and auto-detecting peak highlights.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setConnecting(false);
    }
  }

  async function controlStream(
    streamId: string,
    action: "start" | "stop" | "recheck" | "configure" | "set_auth",
    nextAuth?: boolean,
    overrides?: {
      postBufferSeconds?: number;
      hypeThreshold?: number;
      videoQuality?: VideoQuality;
      shortsLayout?: ShortsLayout;
      autoShortsEnabled?: boolean;
      autoDownloadEnabled?: boolean;
    }
  ) {
    setBusyAction(`${streamId}:${action}`);
    const effPost = overrides?.postBufferSeconds ?? postBufferDraft;
    const effHype = overrides?.hypeThreshold ?? hypeThresholdDraft;
    const effQuality = overrides?.videoQuality ?? videoQualityDraft;
    const effLayout = overrides?.shortsLayout ?? shortsLayoutDraft;
    const effShorts = overrides?.autoShortsEnabled ?? autoShortsDraft;
    const effAutoDl = overrides?.autoDownloadEnabled ?? autoDownloadDraft;
    try {
      const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          postBufferSeconds: effPost,
          minAiScore: minScoreDraft,
          hypeThreshold: effHype,
          videoQuality: effQuality,
          shortsLayout: effLayout,
          autoShortsEnabled: effShorts,
          autoDownloadEnabled: effAutoDl,
          dedupeCooldownSeconds: cooldownDraft,
          ...(nextAuth !== undefined ? { isAuthorized: nextAuth } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed.");

      if (data.stream) {
        setStreams((prev) =>
          prev.map((s) => (s.id === streamId ? data.stream : s))
        );
      }
      if (data.buffer) {
        setBuffers((prev) => ({ ...prev, [streamId]: data.buffer }));
      }
      if (action === "configure") {
        const qName =
          effQuality === "1080p_source"
            ? "1080p60 Source"
            : effQuality === "1080p_high"
            ? "1080p60 High"
            : "720p60 HD";
        const lName =
          effLayout === "fit_blur"
            ? "Full-Frame Short"
            : effLayout === "split_cam"
            ? "Facecam Split Short"
            : "9:16 Zoom Short";
        notify({
          type: "success",
          title: "1080p60 Quality & Full-Length Shorts Saved",
          description: `${qName} · ${20 + effPost}s full length · ${
            effShorts ? `Original 16:9 + ${lName}` : "Original 16:9 only"
          } · Hype ≥ ${effHype}/100.`,
        });
      } else if (action === "recheck") {
        notify({
          type: data.stream?.status === "ready" ? "success" : "info",
          title: `Live Check: ${data.stream?.channelName}`,
          description: data.stream?.statusReason,
        });
      } else if (action === "set_auth") {
        notify({
          type: "info",
          title: nextAuth
            ? "MP4 Export Enabled"
            : "Switched to Preview-Only Mode",
          description: nextAuth
            ? "Clips from this stream can now be exported as MP4."
            : "Downloads paused until broadcaster permission is enabled.",
        });
      }
    } catch (err) {
      notify({
        type: "error",
        title: "Stream Control Error",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function triggerEvent(
    streamId: string,
    scenario: "clutch" | "music_record" | "manual" | "dedupe_check",
    bypassCooldown = false
  ) {
    setBusyAction(`trigger:${scenario}`);
    try {
      const res = await fetch(
        `/api/streams/${encodeURIComponent(streamId)}/trigger`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scenario, bypassCooldown }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clip trigger failed.");

      if (data.status === "duplicate_suppressed") {
        notify({
          type: "info",
          title: "Duplicate Clip Suppressed",
          description: data.message,
        });
      } else if (data.clip) {
        setLastClip(data.clip);
        setLastShortClip(data.shortClip || null);
        setLastExportFiles(data.exportFiles || []);
        if (data.autoDownloadStatus === "off") {
          notify({
            type: "success",
            title: data.shortClip
              ? `Saved Original 16:9 + 9:16 Short (AI ${data.clip.aiScore}/100)`
              : `Saved ${data.clip.durationSeconds}s MP4 Clip (AI ${data.clip.aiScore}/100)`,
            description: data.message,
          });
        }
      }
      await loadStreams();
    } catch (err) {
      notify({
        type: "error",
        title: "Clip Capture Error",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function removeStream(streamId: string) {
    const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      notify({
        type: "error",
        title: "Cannot remove",
        description: data.error,
      });
      return;
    }
    setStreams((prev) => prev.filter((s) => s.id !== streamId));
    if (selectedId === streamId) setSelectedId("stream-demo-sandbox");
    notify({ type: "info", title: "Stream removed" });
  }

  const isLocalVideoPreview = Boolean(
    activeStream?.previewVideoUrl &&
      (activeStream.previewVideoUrl.startsWith("/api/media/") ||
        activeStream.previewVideoUrl.toLowerCase().endsWith(".mp4"))
  );
  const isImageThumbnail = Boolean(
    activeStream?.previewVideoUrl && !isLocalVideoPreview
  );
  const liveEmbedUrl = activeStream
    ? getLiveEmbedUrl(activeStream, pageHost)
    : null;
  const canCaptureVideo = Boolean(
    activeStream &&
      (activeStream.status === "monitoring" ||
        activeStream.status === "ready") &&
      ((activeStream.localSourcePath &&
        !activeStream.localSourcePath.startsWith("twitch-chat://") &&
        !activeStream.localSourcePath.startsWith("youtube-chat://")) ||
        activeStream.platform === "hls")
  );

  return (
    <StudioShell
      title="Live Monitoring"
      subtitle="Connect any public Twitch, YouTube Live, Kick, or HLS stream with zero API keys — 20s live rolling buffer + real-time chat spike clipping"
      actions={
        <Link
          href="/chat"
          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
        >
          <MessageSquare className="h-3.5 w-3.5 text-blue-600" />
          Live Chat Feed
        </Link>
      }
    >
      <div className="space-y-6 animate-fade-in">
        {/* Zero-API-Key Status Strip */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-zinc-900 mr-1">
              Keyless Live Access:
            </span>
            {[
              "Twitch Live + IRC Chat",
              "YouTube Live + Live Chat",
              "Kick Live + Chat",
              "Direct HLS (.m3u8) & MP4",
            ].map((label) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800"
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                {label}
              </span>
            ))}
          </div>
          <span className="text-[11px] font-semibold text-zinc-500">
            No API keys required
          </span>
        </div>

        {/* Main Monitoring Stage + Connect Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 8 cols: Active Stream Player + 20s Rolling Buffer */}
          <div className="lg:col-span-8 space-y-5">
            {loading ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-16 flex items-center justify-center gap-2 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                Loading stream monitor...
              </div>
            ) : activeStream ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card space-y-5">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <SourceBadge isDemo={activeStream.isDemo} />
                      <StreamStatusBadge
                        status={activeStream.status}
                        isDemo={activeStream.isDemo}
                      />
                      <span className="text-xs font-semibold text-zinc-700">
                        {activeStream.channelName}
                      </span>
                      <span className="text-xs text-zinc-400">·</span>
                      <span className="text-xs font-medium text-zinc-500">
                        {platformLabel(activeStream.platform)} ·{" "}
                        {activeStream.gameName}
                      </span>
                      {activeStream.viewerCount > 0 && !activeStream.isDemo && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                          <Users className="h-3 w-3" />
                          {activeStream.viewerCount.toLocaleString()} watching
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-extrabold text-zinc-950 break-words">
                      {activeStream.title}
                    </h2>
                    <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                      {activeStream.statusReason}
                    </p>
                  </div>

                  {/* Start / Stop / Recheck Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {!activeStream.isDemo &&
                      activeStream.platform !== "upload" && (
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() =>
                            void controlStream(activeStream.id, "recheck")
                          }
                          title="Re-check live status & refresh viewer count"
                          className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              busyAction === `${activeStream.id}:recheck`
                                ? "animate-spin"
                                : ""
                            }`}
                          />
                          Re-check
                        </button>
                      )}

                    {activeStream.status === "monitoring" ? (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void controlStream(activeStream.id, "stop")
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                      >
                        <Square className="h-3.5 w-3.5 fill-white" />
                        Stop Monitor
                      </button>
                    ) : activeStream.status === "ready" ? (
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void controlStream(activeStream.id, "start")
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                      >
                        <Play className="h-3.5 w-3.5 fill-white" />
                        {activeStream.isDemo
                          ? "Start Demo Simulation"
                          : "Start Live Monitoring"}
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Video / Live Broadcast Monitor Stage */}
                {activeStream.status === "monitoring" ||
                activeStream.status === "ready" ? (
                  isLocalVideoPreview && activeStream.previewVideoUrl ? (
                    <div className="relative rounded-2xl overflow-hidden bg-zinc-950 aspect-video">
                      <video
                        key={`${activeStream.id}-${activeStream.status}`}
                        src={activeStream.previewVideoUrl}
                        autoPlay={activeStream.status === "monitoring"}
                        muted
                        loop
                        controls
                        playsInline
                        className="h-full w-full object-contain"
                      />
                      <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2">
                        {activeStream.isDemo ? (
                          <span className="rounded-lg bg-amber-500/95 px-2.5 py-1 text-[11px] font-bold text-zinc-950 shadow">
                            DEMO SANDBOX FEED — NOT A LIVE STREAM
                          </span>
                        ) : (
                          <span className="rounded-lg bg-emerald-600/95 px-2.5 py-1 text-[11px] font-bold text-white shadow">
                            LOCAL VIDEO FEED
                          </span>
                        )}
                      </div>
                    </div>
                  ) : showLiveEmbed && liveEmbedUrl ? (
                    <div className="relative rounded-2xl overflow-hidden bg-zinc-950 aspect-video">
                      <iframe
                        src={liveEmbedUrl}
                        title={activeStream.title}
                        allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="h-full w-full border-0"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLiveEmbed(false)}
                        className="absolute top-3 right-3 rounded-lg bg-zinc-950/85 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-zinc-900 transition"
                      >
                        Snapshot View
                      </button>
                    </div>
                  ) : (
                    <div className="relative rounded-2xl overflow-hidden bg-zinc-950 aspect-video flex items-center justify-center">
                      {isImageThumbnail && activeStream.previewVideoUrl && (
                        <img
                          src={`${activeStream.previewVideoUrl}${
                            activeStream.previewVideoUrl.includes("?")
                              ? "&"
                              : "?"
                          }_t=${thumbNonce}`}
                          alt={activeStream.title}
                          className="h-full w-full object-cover opacity-85"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/30" />
                      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white shadow">
                          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                          LIVE · {platformLabel(activeStream.platform).toUpperCase()}
                        </span>
                        {activeBuffer?.liveChatConnected && (
                          <span className="rounded-lg bg-zinc-950/80 border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                            {activeBuffer.liveChatSource || "Live Chat Connected"}
                          </span>
                        )}
                      </div>

                      <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-200">
                          Background 20s rolling buffer captures lossless{" "}
                          {videoQualityDraft === "720p_balanced"
                            ? "720p60 HD"
                            : "1080p60 Full HD (Source)"}{" "}
                          + full-length 1080×1920 Shorts.
                        </p>
                        <div className="flex items-center gap-2">
                          {liveEmbedUrl && (
                            <button
                              type="button"
                              onClick={() => setShowLiveEmbed(true)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-zinc-100 transition shadow"
                            >
                              <MonitorPlay className="h-3.5 w-3.5 text-blue-600" />
                              Watch Live Player
                            </button>
                          )}
                          {/^https?:\/\//i.test(activeStream.streamUrl) && (
                            <a
                              href={activeStream.streamUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-xl bg-zinc-900/90 border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 transition"
                            >
                              Open Stream
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-10 text-center">
                    <Radio className="h-7 w-7 text-zinc-400 mx-auto" />
                    <p className="mt-3 text-sm font-bold text-zinc-900">
                      {activeStream.channelName} Is Not Currently Live
                    </p>
                    <p className="mt-1 text-xs text-zinc-600 max-w-lg mx-auto leading-relaxed">
                      {activeStream.statusReason}
                    </p>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void controlStream(activeStream.id, "recheck")
                      }
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Re-check Live Status
                    </button>
                  </div>
                )}

                {/* 20-Second Rolling Video Buffer Visualizer */}
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-extrabold text-zinc-950">
                        Rolling 20-Second Pre-Event Buffer +{" "}
                        {activeStream.postBufferSeconds}s Post-Event Capture
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {activeBuffer
                          ? `Holding last ${activeBuffer.bufferDurationSec.toFixed(
                              1
                            )}s / 20.0s live footage · Status: ${activeBuffer.captureState.replace(
                              "_",
                              " "
                            )}${
                              activeBuffer.liveChatConnected
                                ? ` · ${activeBuffer.liveChatSource} active`
                                : ""
                            }`
                          : "Start monitoring to maintain the live 20-second rolling buffer & real-time chat detector."}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-bold text-blue-600">
                      {activeBuffer
                        ? `${activeBuffer.bufferDurationSec.toFixed(0)}s / 20s`
                        : "0s / 20s"}
                    </span>
                  </div>

                  {/* 10 x 2s buffer segments */}
                  <div className="grid grid-cols-10 gap-1.5">
                    {Array.from({ length: 10 }).map((_, idx) => {
                      const seg = activeBuffer?.segments?.[idx];
                      const filled = Boolean(seg?.filled);
                      const hot = (seg?.excitement || 0) >= 72;
                      return (
                        <div key={idx} className="space-y-1">
                          <div
                            className={`h-7 rounded-lg border transition-all duration-300 flex items-center justify-center text-[10px] font-mono font-bold ${
                              !filled
                                ? "bg-white border-zinc-200 text-zinc-300"
                                : hot
                                ? "bg-blue-600 border-blue-700 text-white shadow-sm"
                                : "bg-blue-100 border-blue-200 text-blue-800"
                            }`}
                          >
                            2s
                          </div>
                          <p className="text-[9px] text-center font-mono text-zinc-400">
                            -{(10 - idx) * 2}s
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Real-Time Telemetry KPIs */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                    <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2">
                      <span className="text-[10px] font-medium text-zinc-500 block">
                        Live Chat Velocity
                      </span>
                      <span className="font-mono text-sm font-bold text-zinc-950">
                        {activeBuffer
                          ? activeBuffer.chatRatePerMin > 0
                            ? `${activeBuffer.chatRatePerMin}/m (${activeBuffer.chatMultiplier}x)`
                            : activeBuffer.liveChatConnected
                            ? "Listening..."
                            : "Video Signal"
                          : "—"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2">
                      <span className="text-[10px] font-medium text-zinc-500 block">
                        Hype / Motion Index
                      </span>
                      <span className="font-mono text-sm font-bold text-zinc-950">
                        {activeBuffer
                          ? `${activeBuffer.combinedExcitement}/100`
                          : "—"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2">
                      <span className="text-[10px] font-medium text-zinc-500 block">
                        Export Mode
                      </span>
                      <button
                        type="button"
                        disabled={activeStream.isDemo || busyAction !== null}
                        onClick={() =>
                          void controlStream(
                            activeStream.id,
                            "set_auth",
                            !activeStream.isAuthorized
                          )
                        }
                        className={`text-left font-mono text-xs font-bold ${
                          activeStream.isAuthorized || activeStream.isDemo
                            ? "text-emerald-700"
                            : "text-amber-700 underline"
                        }`}
                      >
                        {activeStream.isAuthorized || activeStream.isDemo
                          ? "MP4 Enabled"
                          : "Preview Only"}
                      </button>
                    </div>
                    <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2">
                      <span className="text-[10px] font-medium text-zinc-500 block">
                        Dedupe Cooldown
                      </span>
                      <span className="font-mono text-sm font-bold text-zinc-950">
                        {activeBuffer && activeBuffer.cooldownRemainingSec > 0
                          ? `${activeBuffer.cooldownRemainingSec}s active`
                          : "Ready"}
                      </span>
                    </div>
                  </div>

                  {/* Live Hype Threshold Auto-Shorts & Auto-Download Meter */}
                  <div className="rounded-xl border border-blue-200/80 bg-white p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Flame className="h-4 w-4 text-blue-600" />
                        <span className="text-xs font-extrabold text-zinc-950">
                          Hype Auto-Trigger
                        </span>
                        <span className="rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 font-mono text-[10px] font-bold text-blue-700">
                          ≥ {hypeThresholdDraft}/100
                        </span>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-zinc-700">
                        Live Hype:{" "}
                        <strong
                          className={
                            (activeBuffer?.combinedExcitement ?? 0) >=
                            hypeThresholdDraft
                              ? "text-emerald-600"
                              : "text-blue-600"
                          }
                        >
                          {activeBuffer
                            ? `${activeBuffer.combinedExcitement}/100`
                            : "Idle"}
                        </strong>
                      </span>
                    </div>

                    {/* Visual bar with threshold marker */}
                    <div className="relative h-2.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          (activeBuffer?.combinedExcitement ?? 0) >=
                          hypeThresholdDraft
                            ? "bg-emerald-500"
                            : "bg-blue-600"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            activeBuffer?.combinedExcitement ?? 0
                          )}%`,
                        }}
                      />
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-zinc-950"
                        style={{ left: `${hypeThresholdDraft}%` }}
                        title={`Auto-Trigger at ${hypeThresholdDraft}/100`}
                      />
                    </div>

                    {/* Quick Pipeline Controls: Dual Format + Auto-Download + Sensitivity Presets */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => {
                            const next = !autoShortsDraft;
                            setAutoShortsDraft(next);
                            void controlStream(
                              activeStream.id,
                              "configure",
                              undefined,
                              { autoShortsEnabled: next }
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                            autoShortsDraft
                              ? "border-blue-600 bg-blue-600 text-white"
                              : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                          }`}
                        >
                          <Smartphone className="h-3 w-3" />
                          {autoShortsDraft
                            ? "Save Both: 16:9 Original + 9:16 Short"
                            : "16:9 Original Only"}
                        </button>

                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => {
                            const next = !autoDownloadDraft;
                            setAutoDownloadDraft(next);
                            void controlStream(
                              activeStream.id,
                              "configure",
                              undefined,
                              { autoDownloadEnabled: next }
                            );
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                            autoDownloadDraft
                              ? "border-emerald-600 bg-emerald-600 text-white"
                              : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100"
                          }`}
                        >
                          <Download className="h-3 w-3" />
                          {autoDownloadDraft
                            ? "Auto-Download ON (Warns on Music)"
                            : "Auto-Download OFF"}
                        </button>
                      </div>

                      <div className="flex items-center gap-1 text-[10px]">
                        <span className="text-zinc-500 mr-0.5">Sensitivity:</span>
                        {[
                          { label: "High (52)", val: 52 },
                          { label: "Normal (70)", val: 70 },
                          { label: "Clutch (85)", val: 85 },
                        ].map((preset) => (
                          <button
                            key={preset.val}
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => {
                              setHypeThresholdDraft(preset.val);
                              void controlStream(
                                activeStream.id,
                                "configure",
                                undefined,
                                { hypeThreshold: preset.val }
                              );
                            }}
                            className={`rounded-md px-2 py-0.5 font-semibold border transition ${
                              hypeThresholdDraft === preset.val
                                ? "bg-zinc-950 text-white border-zinc-950"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 1080p60 Video Quality + Full-Frame / Full-Length Shorts Selector Row */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 text-[10px]">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-zinc-500 font-semibold mr-0.5">
                          Quality:
                        </span>
                        {(
                          [
                            { id: "1080p_source", label: "1080p60 Source" },
                            { id: "1080p_high", label: "1080p60 High" },
                            { id: "720p_balanced", label: "720p60 HD" },
                          ] as const
                        ).map((q) => (
                          <button
                            key={q.id}
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => {
                              setVideoQualityDraft(q.id);
                              void controlStream(
                                activeStream.id,
                                "configure",
                                undefined,
                                { videoQuality: q.id }
                              );
                            }}
                            className={`rounded-md px-2 py-0.5 font-semibold border transition ${
                              videoQualityDraft === q.id
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                            }`}
                          >
                            {q.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-zinc-500 font-semibold mr-0.5">
                          Shorts View:
                        </span>
                        {(
                          [
                            { id: "fit_blur", label: "Full Frame (No Crop)" },
                            { id: "split_cam", label: "Facecam Split" },
                            { id: "zoom_crop", label: "9:16 Zoom" },
                          ] as const
                        ).map((lay) => (
                          <button
                            key={lay.id}
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => {
                              setShortsLayoutDraft(lay.id);
                              void controlStream(
                                activeStream.id,
                                "configure",
                                undefined,
                                { shortsLayout: lay.id }
                              );
                            }}
                            className={`rounded-md px-2 py-0.5 font-semibold border transition ${
                              shortsLayoutDraft === lay.id
                                ? "bg-zinc-950 text-white border-zinc-950"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                            }`}
                          >
                            {lay.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        <span className="text-zinc-500 font-semibold mr-0.5">
                          Short Length:
                        </span>
                        {[
                          { label: "28s", post: 8 },
                          { label: "45s", post: 25 },
                          { label: "60s Full", post: 40 },
                        ].map((dur) => (
                          <button
                            key={dur.post}
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() => {
                              setPostBufferDraft(dur.post);
                              void controlStream(
                                activeStream.id,
                                "configure",
                                undefined,
                                { postBufferSeconds: dur.post }
                              );
                            }}
                            className={`rounded-md px-2 py-0.5 font-semibold border transition ${
                              postBufferDraft === dur.post
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50"
                            }`}
                          >
                            {dur.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Automatic & 1-Click Rolling Buffer Clip Capture */}
                {canCaptureVideo && (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-zinc-950">
                          {activeStream.isDemo
                            ? "Event Detection & FFmpeg Clip Generator (Demo Sandbox)"
                            : `Live Clip Capture — ${activeStream.channelName} (${platformLabel(
                                activeStream.platform
                              )})`}
                        </p>
                        {!activeStream.isDemo && (
                          <p className="text-[11px] text-zinc-500">
                            When Hype hits {hypeThresholdDraft}/100, CLIPX AI
                            automatically saves{" "}
                            {autoShortsDraft
                              ? "BOTH the untouched 16:9 Original MP4 & a captioned 9:16 Short MP4"
                              : "the 16:9 Original MP4"}
                            {autoDownloadDraft
                              ? " and auto-downloads both to exports/ + browser (pausing with a warning if copyrighted music is detected)."
                              : "."}
                          </p>
                        )}
                      </div>
                      {busyAction?.startsWith("trigger:") && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {autoShortsDraft
                            ? "Saving 16:9 Original + Rendering 9:16 Short..."
                            : `Capturing 20s pre + ${activeStream.postBufferSeconds}s post MP4...`}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() =>
                          void triggerEvent(activeStream.id, "manual", true)
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                      >
                        {busyAction === "trigger:manual" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Camera className="h-3.5 w-3.5" />
                        )}
                        {autoShortsDraft
                          ? `Clip Now (Save 16:9 + 9:16 Short)`
                          : `Clip Last 20s + ${activeStream.postBufferSeconds}s Live Now`}
                      </button>

                      {!activeStream.isDemo && (
                        <Link
                          href="/chat"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-600" />
                          Watch Live Chat Spikes
                        </Link>
                      )}

                      {activeStream.isDemo && (
                        <>
                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void triggerEvent(activeStream.id, "clutch", true)
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                          >
                            <Zap className="h-3.5 w-3.5 text-blue-400" />
                            Simulate 1v5 Hype Spike
                          </button>

                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void triggerEvent(
                                activeStream.id,
                                "music_record",
                                true
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50 transition"
                          >
                            <Music className="h-3.5 w-3.5 text-amber-600" />
                            Simulate Music Warning
                          </button>

                          <button
                            type="button"
                            disabled={busyAction !== null}
                            onClick={() =>
                              void triggerEvent(
                                activeStream.id,
                                "dedupe_check",
                                false
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition"
                          >
                            <CopyX className="h-3.5 w-3.5 text-zinc-500" />
                            Test Duplicate Guard
                          </button>
                        </>
                      )}
                    </div>

                    {lastClip && (
                      <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3.5 space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={lastClip.posterUrl}
                              alt=""
                              className="h-12 w-20 rounded-lg object-cover bg-black shrink-0"
                            />
                            {lastShortClip && (
                              <img
                                src={lastShortClip.posterUrl}
                                alt=""
                                className="h-12 w-7 rounded-md object-cover bg-black border border-blue-300 shrink-0"
                                title="Auto-generated 9:16 Short"
                              />
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  ORIGINAL {lastClip.width}×{lastClip.height}
                                </span>
                                {lastShortClip && (
                                  <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                    + FULL SHORT {lastShortClip.width}×
                                    {lastShortClip.height} (
                                    {lastShortClip.durationSeconds}s)
                                  </span>
                                )}
                                <span className="text-[10px] font-mono font-bold text-zinc-700">
                                  AI {lastClip.aiScore}/100 ·{" "}
                                  {lastClip.durationSeconds}s
                                </span>
                              </div>
                              <p className="text-xs font-bold text-zinc-950 truncate">
                                {lastClip.title}
                              </p>
                              <p className="text-[11px] text-zinc-600">
                                {lastClip.music.flagged
                                  ? "Copyright music warning flagged — original audio untouched"
                                  : lastExportFiles.length > 0
                                  ? `Auto-saved to ${lastExportFiles.join(
                                      " & "
                                    )}`
                                  : "Clean Audio · Original + Short saved"}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void requestDownloadPair(lastClip.id)
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {lastShortClip
                                ? "Download Both (16:9 + 9:16)"
                                : "Download MP4"}
                            </button>
                            <Link
                              href={`/editor?clip=${encodeURIComponent(
                                lastShortClip?.id || lastClip.id
                              )}`}
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                            >
                              Edit Clip
                            </Link>
                            <Link
                              href="/downloads"
                              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition"
                            >
                              Exports
                            </Link>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Per-Stream Capture Configuration */}
                <div className="border-t border-zinc-100 pt-4">
                  <p className="text-xs font-bold text-zinc-900 mb-3">
                    Automatic Capture Window & Deduplication Settings
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-600 font-semibold">
                          Hype Trigger
                        </span>
                        <span className="font-mono font-bold text-blue-600">
                          {hypeThresholdDraft}/100
                        </span>
                      </div>
                      <input
                        type="range"
                        min={30}
                        max={95}
                        value={hypeThresholdDraft}
                        onChange={(e) =>
                          setHypeThresholdDraft(Number(e.target.value))
                        }
                        className="clipx-slider w-full"
                      />
                      <p className="text-[10px] text-zinc-400 mt-1">
                        Lower = captures more moments
                      </p>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-600">Post-Event Footage</span>
                        <span className="font-mono font-bold text-zinc-950">
                          +{postBufferDraft}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={3}
                        max={40}
                        value={postBufferDraft}
                        onChange={(e) =>
                          setPostBufferDraft(Number(e.target.value))
                        }
                        className="clipx-slider w-full"
                      />
                      <p className="text-[10px] text-zinc-400 mt-1">
                        Full clip & Short: {20 + postBufferDraft}s (20s pre +{" "}
                        {postBufferDraft}s post — up to 60s)
                      </p>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-600">Min AI Score</span>
                        <span className="font-mono font-bold text-zinc-950">
                          {minScoreDraft}/100
                        </span>
                      </div>
                      <input
                        type="range"
                        min={35}
                        max={95}
                        value={minScoreDraft}
                        onChange={(e) =>
                          setMinScoreDraft(Number(e.target.value))
                        }
                        className="clipx-slider w-full"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-600">Duplicate Cooldown</span>
                        <span className="font-mono font-bold text-zinc-950">
                          {cooldownDraft}s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        step={5}
                        value={cooldownDraft}
                        onChange={(e) =>
                          setCooldownDraft(Number(e.target.value))
                        }
                        className="clipx-slider w-full"
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        void controlStream(activeStream.id, "configure")
                      }
                      className="rounded-xl border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 transition"
                    >
                      Apply Capture Settings
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {/* Right 4 cols: Connect Any Live Stream (Zero API Key) + Stream List */}
          <div className="lg:col-span-4 space-y-5">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-extrabold text-zinc-950">
                  Connect Any Live Stream
                </h2>
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  NO API KEY
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Paste any creator&apos;s live URL or channel username — starts
                buffering the last 20 seconds and reading live chat immediately.
              </p>

              <div className="mt-3 grid grid-cols-2 rounded-xl bg-zinc-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setConnectTab("url")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition ${
                    connectTab === "url"
                      ? "bg-white text-zinc-950 shadow-subtle"
                      : "text-zinc-600"
                  }`}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Live Channel / URL
                </button>
                <button
                  type="button"
                  onClick={() => setConnectTab("upload")}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 transition ${
                    connectTab === "upload"
                      ? "bg-white text-zinc-950 shadow-subtle"
                      : "text-zinc-600"
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Local Video
                </button>
              </div>

              {connectTab === "url" ? (
                <form onSubmit={handleConnectUrl} className="mt-4 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Platform (Auto-detected from URL)
                    </label>
                    <select
                      value={platform}
                      onChange={(e) =>
                        setPlatform(e.target.value as StreamPlatform)
                      }
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="twitch">Twitch Live (No API Key)</option>
                      <option value="youtube">YouTube Live (No API Key)</option>
                      <option value="kick">Kick Live (No API Key)</option>
                      <option value="hls">Direct HLS (.m3u8) / MP4 URL</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Live URL or Channel Username
                    </label>
                    <input
                      type="text"
                      required
                      value={streamUrl}
                      onChange={(e) => setStreamUrl(e.target.value)}
                      placeholder={
                        platform === "hls"
                          ? "https://example.com/live/stream.m3u8"
                          : platform === "youtube"
                          ? "https://youtube.com/watch?v=... or @channel"
                          : platform === "kick"
                          ? "https://kick.com/username or username"
                          : "https://twitch.tv/shroud or shroud"
                      }
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Game Override (Optional — auto-filled when live)
                    </label>
                    <input
                      type="text"
                      value={gameName}
                      onChange={(e) => setGameName(e.target.value)}
                      placeholder="Auto-detected from live stream"
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <label className="flex items-start gap-2 rounded-xl bg-zinc-50 border border-zinc-200/80 p-2.5 text-[11px] text-zinc-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isAuthorized}
                      onChange={(e) => setIsAuthorized(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                    />
                    <span>
                      Enable MP4 export (I own this stream or have creator
                      permission / fair-use rights to save clips).
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={connecting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                  >
                    {connecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Radio className="h-3.5 w-3.5" />
                    )}
                    {connecting
                      ? "Connecting Live Stream..."
                      : "Connect & Monitor Live"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleUploadIngest} className="mt-4 space-y-3">
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Upload an MP4/WebM/MOV gameplay recording (up to 60 MB) to
                    run a 20s FFmpeg buffer + automatic peak highlight capture.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Gameplay Video File
                    </label>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime"
                      onChange={(e) =>
                        setUploadFile(e.target.files?.[0] || null)
                      }
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-700 file:mr-2.5 file:rounded-lg file:border-0 file:bg-zinc-950 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      placeholder="Session title"
                      className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-blue-600 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={gameName}
                      onChange={(e) => setGameName(e.target.value)}
                      placeholder="Game name"
                      className="rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={connecting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {connecting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Upload & Auto-Detect Clips
                  </button>
                </form>
              )}
            </div>

            {/* Connected Streams List */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <h2 className="text-sm font-extrabold text-zinc-950 mb-3">
                Stream Sources ({streams.length})
              </h2>
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-0.5">
                {streams.map((s) => {
                  const selected = activeStream?.id === s.id;
                  return (
                    <div
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`cursor-pointer rounded-xl border p-3 transition ${
                        selected
                          ? "border-blue-600 bg-blue-50/40"
                          : "border-zinc-200 hover:border-zinc-300 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <SourceBadge isDemo={s.isDemo} size="xs" />
                            <span className="text-[11px] font-medium text-zinc-500">
                              {platformLabel(s.platform)}
                            </span>
                            {!s.isDemo && s.viewerCount > 0 && (
                              <span className="text-[10px] font-mono text-zinc-400">
                                · {s.viewerCount.toLocaleString()}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-bold text-zinc-950 truncate">
                            {s.channelName}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            {s.gameName}
                          </p>
                        </div>
                        {!s.isDemo && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void removeStream(s.id);
                            }}
                            className="rounded-lg p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                            title="Remove stream"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="mt-2">
                        <StreamStatusBadge status={s.status} isDemo={s.isDemo} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* 1-Click Live Gaming Stream Directory (Twitch + YouTube Live — Zero API Key!) */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Compass className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-extrabold text-zinc-950">
                  Live Gaming Streams Right Now (1-Click Connect · No API Key)
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-zinc-500">
                Real-time public broadcasts from Twitch & YouTube Live. Click
                any live stream to attach the 20s rolling buffer and live chat
                monitor immediately.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadDiscover(discoverSearch.trim());
              }}
              className="flex items-center gap-2"
            >
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={discoverSearch}
                  onChange={(e) => setDiscoverSearch(e.target.value)}
                  placeholder="Filter by game (e.g. Dota 2)"
                  className="rounded-xl border border-zinc-200 pl-8 pr-3 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none w-52"
                />
              </div>
              <button
                type="button"
                disabled={loadingDiscover}
                onClick={() =>
                  void loadDiscover(discoverSearch.trim() || discoverCategory)
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    loadingDiscover ? "animate-spin" : ""
                  }`}
                />
                Refresh
              </button>
            </form>
          </div>

          {/* Game Quick Filter Pills */}
          <div className="flex flex-wrap gap-1.5">
            {GAME_FILTERS.map((g) => {
              const active =
                discoverCategory === g.query && !discoverSearch.trim();
              return (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => {
                    setDiscoverSearch("");
                    setDiscoverCategory(g.query);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "bg-zinc-950 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200/70"
                  }`}
                >
                  {g.label}
                </button>
              );
            })}
          </div>

          {loadingDiscover ? (
            <div className="py-10 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
              Fetching currently-live gaming streams...
            </div>
          ) : discovered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 py-8 text-center text-xs text-zinc-500">
              No live directory streams matched that filter. Paste any
              Twitch/YouTube/Kick URL directly in the box above.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {discovered.slice(0, 8).map((item) => {
                const isBusy = connectingCardUrl === item.streamUrl;
                return (
                  <div
                    key={`${item.platform}-${item.channelId}`}
                    className="group rounded-2xl border border-zinc-200 bg-white overflow-hidden hover:border-zinc-300 hover:shadow-card transition flex flex-col"
                  >
                    <div className="relative aspect-video bg-zinc-950 overflow-hidden">
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        loading="lazy"
                        className="h-full w-full object-cover group-hover:scale-[1.02] transition duration-300"
                      />
                      <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
                        LIVE · {item.platform === "twitch" ? "TWITCH" : "YOUTUBE"}
                      </span>
                      {item.viewerCount > 0 && (
                        <span className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-0.5 text-[10px] font-mono font-semibold text-white">
                          {item.viewerCount.toLocaleString()} viewers
                        </span>
                      )}
                    </div>

                    <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                      <div>
                        <p className="text-xs font-bold text-zinc-950 line-clamp-1">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-zinc-500 truncate">
                          <span className="font-semibold text-zinc-700">
                            {item.channelName}
                          </span>{" "}
                          · {item.gameName}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={connectingCardUrl !== null}
                        onClick={() => void handleQuickConnect(item)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-50 transition"
                      >
                        {isBusy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Connecting...
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3 fill-white" />
                            Monitor & Clip Live
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
