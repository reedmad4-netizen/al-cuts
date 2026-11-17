"use client";

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Captions,
  CheckCircle2,
  Crop,
  Download,
  FileText,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  Subtitles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { MusicBadge, SourceBadge } from "@/components/Badges";
import { ScoreBar } from "@/components/ScoreBar";
import { StudioShell } from "@/components/StudioShell";
import { formatBytes, formatPreciseTime } from "@/lib/format";
import type {
  AspectRatio,
  CaptionConfig,
  ClipRecord,
  ShortsLayout,
  SubtitleCue,
  VideoQuality,
} from "@/lib/types";

function VideoEditorInner() {
  const searchParams = useSearchParams();
  const initialClipId = searchParams.get("clip");
  const { notify, requestDownload } = useApp();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [loopTrim, setLoopTrim] = useState(true);

  // Editor controls state
  const [activeTab, setActiveTab] = useState<
    "trim" | "crop" | "captions" | "subtitles" | "audio"
  >("trim");
  const [editTitle, setEditTitle] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(15);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [shortsLayout, setShortsLayout] = useState<ShortsLayout>("fit_blur");
  const [renderQuality, setRenderQuality] =
    useState<VideoQuality>("1080p_source");
  const [cropOffsetX, setCropOffsetX] = useState(0);
  const [caption, setCaption] = useState<CaptionConfig>({
    text: "",
    position: "top",
    style: "pill",
    fontSize: "md",
  });
  const [subtitles, setSubtitles] = useState<SubtitleCue[]>([]);

  // Copyright & Render state
  const [rendering, setRendering] = useState(false);
  const [scanningMusic, setScanningMusic] = useState(false);
  const [showRenderCopyrightModal, setShowRenderCopyrightModal] =
    useState(false);
  const [userPermittedMute, setUserPermittedMute] = useState(false);
  const [renderedClip, setRenderedClip] = useState<ClipRecord | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const res = await fetch("/api/clips?source=all", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const list: ClipRecord[] = data.clips || [];
      setClips(list);

      if (list.length > 0) {
        const match =
          (initialClipId && list.find((c) => c.id === initialClipId)) ||
          list[0];
        setSelectedClipId((prev) => prev || match.id);
      }
    } finally {
      setLoading(false);
    }
  }, [initialClipId]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    if (initialClipId && clips.some((c) => c.id === initialClipId)) {
      setSelectedClipId(initialClipId);
    }
  }, [initialClipId, clips]);

  const activeClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) || null,
    [clips, selectedClipId]
  );

  // Sync editor fields when selected clip changes
  useEffect(() => {
    if (!activeClip) return;
    setEditTitle(activeClip.title);
    setStartTime(0);
    setEndTime(Number(activeClip.durationSeconds.toFixed(1)));
    setAspectRatio(activeClip.aspectRatio || "16:9");
    setCropOffsetX(0);
    setCaption(
      activeClip.caption || {
        text: "",
        position: "top",
        style: "pill",
        fontSize: "md",
      }
    );
    setSubtitles(activeClip.subtitles || []);
    setUserPermittedMute(false);
    setRenderedClip(null);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [activeClip]);

  // Keep playback inside [startTime, endTime] when loopTrim is enabled
  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setCurrentTime(t);
    if (t >= endTime - 0.05) {
      if (loopTrim) {
        v.currentTime = startTime;
        void v.play().catch(() => {});
      } else {
        v.pause();
        setIsPlaying(false);
      }
    }
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < startTime || v.currentTime >= endTime - 0.1) {
        v.currentTime = startTime;
      }
      void v.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  function seekTo(sec: number) {
    const v = videoRef.current;
    const clamped = Math.max(
      0,
      Math.min(activeClip?.durationSeconds || 30, sec)
    );
    setCurrentTime(clamped);
    if (v) v.currentTime = clamped;
  }

  // Active subtitle cue at current playhead
  const activeSubtitle = useMemo(
    () =>
      subtitles.find(
        (s) =>
          s.text.trim().length > 0 &&
          currentTime >= s.startTime &&
          currentTime <= s.endTime
      ) || null,
    [subtitles, currentTime]
  );

  function addSubtitleCue() {
    if (!activeClip) return;
    const cueStart = Number(
      Math.max(startTime, Math.min(endTime - 1.5, currentTime)).toFixed(1)
    );
    const cueEnd = Number(Math.min(endTime, cueStart + 3.0).toFixed(1));
    setSubtitles((prev) => [
      ...prev,
      {
        id: `cue-${Date.now()}`,
        startTime: cueStart,
        endTime: cueEnd,
        text: "Watch this play right here!",
      },
    ]);
  }

  function autoGenerateSubtitles() {
    if (!activeClip) return;
    const span = Math.max(2, endTime - startTime);
    const mid = Number((startTime + span * 0.55).toFixed(1));
    const generated: SubtitleCue[] = [
      {
        id: `auto-1-${Date.now()}`,
        startTime: Number(startTime.toFixed(1)),
        endTime: Number(Math.min(endTime, startTime + Math.min(3.5, span * 0.45)).toFixed(1)),
        text: `Locked in on ${activeClip.gameName} — wait for it...`,
      },
      {
        id: `auto-2-${Date.now()}`,
        startTime: mid,
        endTime: Number(Math.min(endTime, mid + Math.min(4.0, span * 0.42)).toFixed(1)),
        text: "NO WAY! CLIP THAT RIGHT NOW!",
      },
    ];
    setSubtitles(generated);
    notify({
      type: "success",
      title: "Timed Subtitles Generated",
      description: "Aligned to your trimmed selection — customize any cue below.",
    });
  }

  function downloadSrtFile() {
    if (subtitles.length === 0) return;
    const fmtSrt = (sec: number) => {
      const s = Math.max(0, sec - startTime);
      const hrs = Math.floor(s / 3600);
      const mins = Math.floor((s % 3600) / 60);
      const whole = Math.floor(s % 60);
      const ms = Math.round((s - Math.floor(s)) * 1000);
      return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(
        2,
        "0"
      )}:${String(whole).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    };
    const content = subtitles
      .map(
        (c, i) =>
          `${i + 1}\n${fmtSrt(c.startTime)} --> ${fmtSrt(c.endTime)}\n${
            c.text
          }\n`
      )
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clipx-subtitles-${activeClip?.id || "clip"}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRescanMusic() {
    if (!activeClip) return;
    setScanningMusic(true);
    try {
      const res = await fetch(
        `/api/clips/${encodeURIComponent(activeClip.id)}/scan-music`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed.");
      const updated = data.clip as ClipRecord;
      setClips((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      notify({
        type: updated.music.flagged ? "warning" : "success",
        title: updated.music.flagged
          ? `Copyrighted Music Risk (${updated.music.confidence}%)`
          : "Clean Gameplay Audio Confirmed",
        description: updated.music.details,
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Audio scan error",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setScanningMusic(false);
    }
  }

  async function executeRender(ackCopyright: boolean) {
    if (!activeClip) return;
    if (activeClip.music.flagged && !ackCopyright) {
      setShowRenderCopyrightModal(true);
      return;
    }

    setShowRenderCopyrightModal(false);
    setRendering(true);
    try {
      const res = await fetch(
        `/api/clips/${encodeURIComponent(activeClip.id)}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title:
              editTitle.trim() === activeClip.title
                ? `${activeClip.title} (${aspectRatio} Edit)`
                : editTitle.trim(),
            startTime,
            endTime,
            fullLength:
              startTime <= 0.05 &&
              endTime >= Number((activeClip.durationSeconds - 0.12).toFixed(1)),
            aspectRatio,
            shortsLayout,
            quality: renderQuality,
            cropOffsetX,
            caption: caption.text.trim() ? caption : null,
            subtitles,
            copyrightWarningAcknowledged: ackCopyright,
            userPermittedMuteAudio: userPermittedMute,
          }),
        }
      );
      const data = await res.json();
      if (res.status === 409 && data.requiresCopyrightAck) {
        setShowRenderCopyrightModal(true);
        return;
      }
      if (!res.ok) throw new Error(data.error || "FFmpeg render failed.");

      const newClip = data.clip as ClipRecord;
      setRenderedClip(newClip);
      setClips((prev) => [newClip, ...prev]);
    } catch (err) {
      notify({
        type: "error",
        title: "FFmpeg Render Error",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setRendering(false);
    }
  }

  // Compute live visual crop guide overlay when reframing a 16:9 source to 9:16 Zoom or 1:1
  const cropBoxStyle = useMemo<React.CSSProperties | null>(() => {
    if (!activeClip) return null;
    if (aspectRatio === activeClip.aspectRatio) return null;
    if (aspectRatio === "9:16" && shortsLayout === "fit_blur") return null; // Full 100% frame kept!
    // Assuming 16:9 viewport
    const widthPct =
      aspectRatio === "9:16"
        ? (9 / 16 / (16 / 9)) * 100 // ~31.64%
        : aspectRatio === "1:1"
        ? (1 / (16 / 9)) * 100 // 56.25%
        : 100;
    const maxLeft = 100 - widthPct;
    const leftPct = ((cropOffsetX + 1) / 2) * maxLeft;
    return {
      left: `${leftPct.toFixed(2)}%`,
      width: `${widthPct.toFixed(2)}%`,
    };
  }, [activeClip, aspectRatio, cropOffsetX]);

  const trimmedDuration = Math.max(0, Number((endTime - startTime).toFixed(1)));

  return (
    <StudioShell
      title="Video Editor"
      subtitle="Trim start/end timestamps, reframe to 9:16, 16:9, or 1:1, add captions & timed subtitles, and render MP4 via FFmpeg"
      actions={
        clips.length > 0 && (
          <select
            value={selectedClipId}
            onChange={(e) => setSelectedClipId(e.target.value)}
            className="max-w-[230px] sm:max-w-xs rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 focus:border-blue-600 focus:outline-none truncate"
          >
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.isDemo ? "[DEMO] " : "[AUTH] "}
                {c.title} ({c.aspectRatio})
              </option>
            ))}
          </select>
        )
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading FFmpeg studio editor...
        </div>
      ) : !activeClip ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-14 text-center text-sm text-zinc-600">
          No clips available to edit. Generate a clip on Live Monitoring first.
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Newly Rendered Edited MP4 Banner */}
          {renderedClip && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-zinc-950 truncate">
                    Edited MP4 Rendered: {renderedClip.title}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {renderedClip.width}×{renderedClip.height} (
                    {renderedClip.aspectRatio}) · {renderedClip.durationSeconds}s ·{" "}
                    {formatBytes(renderedClip.fileSizeBytes)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedClipId(renderedClip.id)}
                  className="rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-900 hover:bg-emerald-50 transition"
                >
                  Preview Rendered File
                </button>
                <button
                  type="button"
                  onClick={() => requestDownload(renderedClip)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition shadow-subtle"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Edited MP4
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 7 Cols: Interactive Preview Stage + Timeline Scrubber */}
            <div className="lg:col-span-7 space-y-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-card space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge isDemo={activeClip.isDemo} size="xs" />
                    <MusicBadge music={activeClip.music} />
                    <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-mono font-semibold text-zinc-700">
                      Output: {aspectRatio} (
                      {aspectRatio === "9:16"
                        ? "720×1280"
                        : aspectRatio === "1:1"
                        ? "720×720"
                        : "1280×720"}
                      )
                    </span>
                  </div>
                  <span className="font-mono text-xs font-bold text-zinc-700">
                    {formatPreciseTime(currentTime)} /{" "}
                    {formatPreciseTime(activeClip.durationSeconds)}
                  </span>
                </div>

                {/* Video Stage with Live Crop + Caption + Subtitle Preview */}
                <div className="relative rounded-2xl overflow-hidden bg-zinc-950 aspect-video select-none">
                  <video
                    ref={videoRef}
                    key={activeClip.videoUrl}
                    src={activeClip.videoUrl}
                    poster={activeClip.posterUrl}
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    className="h-full w-full object-contain"
                  />

                  {/* Live Crop Window Overlay */}
                  {cropBoxStyle && (
                    <div className="pointer-events-none absolute inset-0">
                      <div
                        className="absolute inset-y-0 border-2 border-blue-500 shadow-[0_0_0_9999px_rgba(9,9,11,0.62)] transition-all duration-100 flex flex-col justify-between overflow-hidden"
                        style={cropBoxStyle}
                      >
                        <span className="self-center mt-1.5 rounded bg-blue-600 px-1.5 py-0.5 text-[9px] font-mono font-bold text-white">
                          {aspectRatio} CROP
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Live Caption Preview Overlay */}
                  {caption.text.trim() && (
                    <div
                      className={`pointer-events-none absolute inset-x-4 flex justify-center px-3 ${
                        caption.position === "top"
                          ? "top-7"
                          : caption.position === "center"
                          ? "top-1/2 -translate-y-1/2"
                          : "bottom-14"
                      }`}
                    >
                      <span
                        className={`max-w-[78%] text-center font-extrabold leading-tight rounded-lg px-3 py-1.5 ${
                          caption.fontSize === "lg"
                            ? "text-base sm:text-lg"
                            : caption.fontSize === "sm"
                            ? "text-xs"
                            : "text-sm"
                        } ${
                          caption.style === "blue"
                            ? "bg-blue-600/95 text-white shadow"
                            : caption.style === "bold"
                            ? "text-white [text-shadow:0_2px_6px_rgba(0,0,0,0.95)]"
                            : "bg-zinc-950/85 text-white shadow"
                        }`}
                      >
                        {caption.text}
                      </span>
                    </div>
                  )}

                  {/* Live Timed Subtitle Preview Overlay */}
                  {activeSubtitle && (
                    <div className="pointer-events-none absolute inset-x-4 bottom-3 flex justify-center">
                      <span className="max-w-[82%] rounded-md bg-black/80 px-2.5 py-1 text-center text-xs font-medium text-white">
                        {activeSubtitle.text}
                      </span>
                    </div>
                  )}
                </div>

                {/* Transport & Interactive Trim Timeline */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3.5 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition"
                      >
                        {isPlaying ? (
                          <>
                            <Pause className="h-3.5 w-3.5" /> Pause
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-white" /> Preview
                            Trim
                          </>
                        )}
                      </button>
                      <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 cursor-pointer ml-1">
                        <input
                          type="checkbox"
                          checked={loopTrim}
                          onChange={(e) => setLoopTrim(e.target.checked)}
                          className="rounded border-zinc-300 text-blue-600 focus:ring-blue-600"
                        />
                        Loop trim
                      </label>
                    </div>

                    <div className="text-xs font-mono text-zinc-600">
                      Trim:{" "}
                      <strong className="text-zinc-950">
                        {startTime.toFixed(1)}s → {endTime.toFixed(1)}s
                      </strong>{" "}
                      <span className="text-blue-600 font-bold">
                        ({trimmedDuration}s)
                      </span>
                    </div>
                  </div>

                  {/* Visual Trim Range Bar + Clickable Playhead */}
                  <div
                    className="relative h-9 rounded-xl bg-zinc-100 border border-zinc-200 overflow-hidden cursor-pointer"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const ratio = (e.clientX - rect.left) / rect.width;
                      seekTo(ratio * activeClip.durationSeconds);
                    }}
                  >
                    {/* Selected trim segment */}
                    <div
                      className="absolute inset-y-0 bg-blue-600/15 border-x-2 border-blue-600"
                      style={{
                        left: `${
                          (startTime / Math.max(1, activeClip.durationSeconds)) *
                          100
                        }%`,
                        width: `${
                          ((endTime - startTime) /
                            Math.max(1, activeClip.durationSeconds)) *
                          100
                        }%`,
                      }}
                    />
                    {/* Subtitle markers */}
                    {subtitles.map((s) => (
                      <div
                        key={s.id}
                        className="absolute bottom-1 h-1.5 rounded-full bg-blue-500/70"
                        style={{
                          left: `${
                            (s.startTime /
                              Math.max(1, activeClip.durationSeconds)) *
                            100
                          }%`,
                          width: `${Math.max(
                            1.5,
                            ((s.endTime - s.startTime) /
                              Math.max(1, activeClip.durationSeconds)) *
                              100
                          )}%`,
                        }}
                      />
                    ))}
                    {/* Playhead */}
                    <div
                      className="absolute inset-y-0 w-0.5 bg-zinc-950"
                      style={{
                        left: `${Math.min(
                          99.5,
                          (currentTime /
                            Math.max(1, activeClip.durationSeconds)) *
                            100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* AI Score Summary Card below player */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle">
                <ScoreBar score={activeClip.aiScore} />
                <p className="mt-2 text-xs text-zinc-500">
                  {activeClip.aiSummary}
                </p>
              </div>
            </div>

            {/* Right 5 Cols: Inspector Tools + Render Export */}
            <div className="lg:col-span-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-card space-y-5">
              {/* Clip Title Input */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  Export Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-950 focus:border-blue-600 focus:outline-none"
                />
              </div>

              {/* Tool Tabs */}
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-zinc-100 p-1 text-[11px] font-semibold">
                {(
                  [
                    { id: "trim", label: "Trim", icon: Scissors },
                    { id: "crop", label: "Crop", icon: Crop },
                    { id: "captions", label: "Caption", icon: Captions },
                    { id: "subtitles", label: "Subs", icon: Subtitles },
                    { id: "audio", label: "Music", icon: Music },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={`flex flex-col items-center gap-1 rounded-lg py-2 transition ${
                        activeTab === t.id
                          ? "bg-white text-blue-700 shadow-subtle"
                          : "text-zinc-600 hover:text-zinc-950"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: TRIM */}
              {activeTab === "trim" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Start Time (sec)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        min={0}
                        max={Math.max(0, endTime - 1)}
                        value={startTime}
                        onChange={(e) => {
                          const v = Math.max(
                            0,
                            Math.min(endTime - 1, Number(e.target.value) || 0)
                          );
                          setStartTime(Number(v.toFixed(1)));
                          seekTo(v);
                        }}
                        className="w-full rounded-xl border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        End Time (sec)
                      </label>
                      <input
                        type="number"
                        step={0.5}
                        min={startTime + 1}
                        max={activeClip.durationSeconds}
                        value={endTime}
                        onChange={(e) => {
                          const v = Math.min(
                            activeClip.durationSeconds,
                            Math.max(
                              startTime + 1,
                              Number(e.target.value) || startTime + 1
                            )
                          );
                          setEndTime(Number(v.toFixed(1)));
                        }}
                        className="w-full rounded-xl border border-zinc-200 px-3 py-2 font-mono text-xs text-zinc-950 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-zinc-500 mb-1">
                      <span>Trim In Slider</span>
                      <span className="font-mono">{startTime.toFixed(1)}s</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, activeClip.durationSeconds - 1)}
                      step={0.5}
                      value={startTime}
                      onChange={(e) => {
                        const v = Math.min(endTime - 1, Number(e.target.value));
                        setStartTime(Number(Math.max(0, v).toFixed(1)));
                        seekTo(Math.max(0, v));
                      }}
                      className="clipx-slider w-full"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-zinc-500 mb-1">
                      <span>Trim Out Slider</span>
                      <span className="font-mono">{endTime.toFixed(1)}s</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={activeClip.durationSeconds}
                      step={0.5}
                      value={endTime}
                      onChange={(e) => {
                        const v = Math.max(startTime + 1, Number(e.target.value));
                        setEndTime(
                          Number(
                            Math.min(activeClip.durationSeconds, v).toFixed(1)
                          )
                        );
                      }}
                      className="clipx-slider w-full"
                    />
                  </div>

                  {/* Quick Highlight & Full-Length Presets */}
                  <div className="pt-1">
                    <p className="text-[11px] font-semibold text-zinc-500 mb-2">
                      Length Presets
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStartTime(0);
                          setEndTime(
                            Number(activeClip.durationSeconds.toFixed(2))
                          );
                          seekTo(0);
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                          startTime <= 0.05 &&
                          endTime >= activeClip.durationSeconds - 0.15
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-zinc-200 text-zinc-800 hover:bg-zinc-50"
                        }`}
                      >
                        Cover Full Length (0:00 → {activeClip.durationSeconds}s)
                      </button>
                      {activeClip.durationSeconds >= 22 && (
                        <button
                          type="button"
                          onClick={() => {
                            setStartTime(14);
                            setEndTime(
                              Number(
                                Math.min(
                                  activeClip.durationSeconds,
                                  26
                                ).toFixed(1)
                              )
                            );
                            seekTo(14);
                          }}
                          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                        >
                          Peak 12s Cut
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: ASPECT RATIO CROP */}
              {activeTab === "crop" && (
                <div className="space-y-4">
                  <p className="text-xs text-zinc-600">
                    Choose an aspect ratio — FFmpeg crops and scales the video
                    cleanly on export.
                  </p>
                  <div className="grid grid-cols-3 gap-2.5">
                    {(
                      [
                        {
                          ratio: "9:16",
                          name: "Vertical",
                          sub: "Shorts / TikTok",
                          box: "h-9 w-5",
                        },
                        {
                          ratio: "16:9",
                          name: "Widescreen",
                          sub: "YouTube / X",
                          box: "h-5 w-9",
                        },
                        {
                          ratio: "1:1",
                          name: "Square",
                          sub: "Feed / Reels",
                          box: "h-7 w-7",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.ratio}
                        type="button"
                        onClick={() => setAspectRatio(opt.ratio)}
                        className={`flex flex-col items-center rounded-xl border p-3 text-center transition ${
                          aspectRatio === opt.ratio
                            ? "border-blue-600 bg-blue-50/60 text-blue-800"
                            : "border-zinc-200 hover:border-zinc-300 text-zinc-700"
                        }`}
                      >
                        <span
                          className={`${opt.box} rounded border-2 mb-2 ${
                            aspectRatio === opt.ratio
                              ? "border-blue-600 bg-blue-100"
                              : "border-zinc-400 bg-zinc-100"
                          }`}
                        />
                        <span className="text-xs font-extrabold text-zinc-950">
                          {opt.ratio}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {opt.sub}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* 9:16 Shorts Framing Mode */}
                  {aspectRatio === "9:16" && (
                    <div className="space-y-2 pt-1">
                      <label className="block text-xs font-semibold text-zinc-700">
                        9:16 Shorts Framing
                      </label>
                      <div className="grid grid-cols-1 gap-2">
                        {(
                          [
                            {
                              id: "fit_blur",
                              title: "Full Frame HD + Blurred Canvas (Recommended)",
                              desc: "Covers 100% of the full widescreen video (facecam, minimap, HUD & crosshair) inside 1080×1920 — nothing cut off.",
                            },
                            {
                              id: "split_cam",
                              title: "Streamer Facecam Top + Gameplay Bottom",
                              desc: "Stacks left facecam on top and centered gameplay action below to fill 1080×1920.",
                            },
                            {
                              id: "zoom_crop",
                              title: "Full-Height 9:16 Zoom Crop",
                              desc: "Zooms into center crosshair to fill 1080×1920 vertically (use pan slider below).",
                            },
                          ] as const
                        ).map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setShortsLayout(m.id)}
                            className={`rounded-xl border p-2.5 text-left transition ${
                              shortsLayout === m.id
                                ? "border-blue-600 bg-blue-50/60"
                                : "border-zinc-200 hover:border-zinc-300"
                            }`}
                          >
                            <p className="text-xs font-bold text-zinc-950">
                              {m.title}
                            </p>
                            <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                              {m.desc}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Output Resolution & Bitrate Quality */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1.5">
                      Output Video Quality
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          {
                            id: "1080p_source",
                            label: "1080p60 Ultra",
                            sub:
                              aspectRatio === "9:16"
                                ? "1080×1920"
                                : aspectRatio === "1:1"
                                ? "1080×1080"
                                : "1920×1080",
                          },
                          {
                            id: "1080p_high",
                            label: "1080p60 High",
                            sub: "6.5 Mbps",
                          },
                          {
                            id: "720p_balanced",
                            label: "720p60 HD",
                            sub: "Smaller MP4",
                          },
                        ] as const
                      ).map((q) => (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setRenderQuality(q.id)}
                          className={`rounded-xl border px-2.5 py-2 text-center transition ${
                            renderQuality === q.id
                              ? "border-blue-600 bg-blue-50 text-blue-800"
                              : "border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                          }`}
                        >
                          <span className="block text-[11px] font-bold text-zinc-950">
                            {q.label}
                          </span>
                          <span className="block text-[10px] font-mono text-zinc-500">
                            {q.sub}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {((aspectRatio === "9:16" && shortsLayout !== "fit_blur") ||
                    aspectRatio === "1:1") && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-zinc-700">
                          Horizontal Framing Pan
                        </span>
                        <span className="font-mono text-zinc-600">
                          {cropOffsetX === 0
                            ? "Center"
                            : cropOffsetX < 0
                            ? `${Math.round(cropOffsetX * 100)}% Left`
                            : `${Math.round(cropOffsetX * 100)}% Right`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.05}
                        value={cropOffsetX}
                        onChange={(e) => setCropOffsetX(Number(e.target.value))}
                        className="clipx-slider w-full"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: CAPTIONS */}
              {activeTab === "captions" && (
                <div className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Headline Caption Overlay
                    </label>
                    <input
                      type="text"
                      maxLength={120}
                      value={caption.text}
                      onChange={(e) =>
                        setCaption((prev) => ({ ...prev, text: e.target.value }))
                      }
                      placeholder="e.g. INSANE 1v5 OVERTIME CLUTCH"
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Position
                      </label>
                      <select
                        value={caption.position}
                        onChange={(e) =>
                          setCaption((p) => ({
                            ...p,
                            position: e.target.value as CaptionConfig["position"],
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-900"
                      >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Style
                      </label>
                      <select
                        value={caption.style}
                        onChange={(e) =>
                          setCaption((p) => ({
                            ...p,
                            style: e.target.value as CaptionConfig["style"],
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-900"
                      >
                        <option value="pill">Dark Pill</option>
                        <option value="blue">CLIPX Blue</option>
                        <option value="bold">Bold Stroke</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-600 mb-1">
                        Size
                      </label>
                      <select
                        value={caption.fontSize}
                        onChange={(e) =>
                          setCaption((p) => ({
                            ...p,
                            fontSize: e.target.value as CaptionConfig["fontSize"],
                          }))
                        }
                        className="w-full rounded-xl border border-zinc-200 bg-white px-2.5 py-2 text-xs text-zinc-900"
                      >
                        <option value="sm">Small</option>
                        <option value="md">Medium</option>
                        <option value="lg">Large</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: TIMED SUBTITLES */}
              {activeTab === "subtitles" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={addSubtitleCue}
                      className="inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 transition"
                    >
                      <Plus className="h-3 w-3" /> Add Cue
                    </button>
                    <button
                      type="button"
                      onClick={autoGenerateSubtitles}
                      className="inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition"
                    >
                      <Wand2 className="h-3 w-3" /> Auto-Subtitles
                    </button>
                    {subtitles.length > 0 && (
                      <button
                        type="button"
                        onClick={downloadSrtFile}
                        className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 transition"
                      >
                        <FileText className="h-3 w-3" /> .SRT
                      </button>
                    )}
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                    {subtitles.length === 0 ? (
                      <p className="text-xs text-zinc-500 py-4 text-center">
                        No subtitle cues. Click Auto-Subtitles or Add Cue to burn
                        timed subtitles into your MP4.
                      </p>
                    ) : (
                      subtitles.map((cue, idx) => (
                        <div
                          key={cue.id}
                          className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-2.5 space-y-1.5"
                        >
                          <div className="flex items-center gap-2 text-[11px]">
                            <input
                              type="number"
                              step={0.2}
                              min={0}
                              value={cue.startTime}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setSubtitles((prev) =>
                                  prev.map((s, i) =>
                                    i === idx ? { ...s, startTime: val } : s
                                  )
                                );
                              }}
                              className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 font-mono text-zinc-900"
                            />
                            <span className="text-zinc-400">→</span>
                            <input
                              type="number"
                              step={0.2}
                              min={0}
                              value={cue.endTime}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                setSubtitles((prev) =>
                                  prev.map((s, i) =>
                                    i === idx ? { ...s, endTime: val } : s
                                  )
                                );
                              }}
                              className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 font-mono text-zinc-900"
                            />
                            <span className="text-zinc-400 text-[10px]">sec</span>
                            <button
                              type="button"
                              onClick={() =>
                                setSubtitles((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="ml-auto text-zinc-400 hover:text-rose-600"
                              aria-label="Remove subtitle cue"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={cue.text}
                            onChange={(e) =>
                              setSubtitles((prev) =>
                                prev.map((s, i) =>
                                  i === idx ? { ...s, text: e.target.value } : s
                                )
                              )
                            }
                            className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900"
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: MUSIC & COPYRIGHT DETECTION */}
              {activeTab === "audio" && (
                <div className="space-y-3">
                  <div
                    className={`rounded-xl border p-3.5 text-xs ${
                      activeClip.music.flagged
                        ? "border-amber-200 bg-amber-50/70 text-amber-950"
                        : "border-emerald-200 bg-emerald-50/60 text-emerald-950"
                    }`}
                  >
                    <p className="font-bold flex items-center gap-1.5">
                      {activeClip.music.flagged ? (
                        <>
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          Potential Copyrighted Music ({activeClip.music.confidence}
                          %)
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Clean Gameplay Audio
                        </>
                      )}
                    </p>
                    <p className="mt-1.5 leading-relaxed opacity-90">
                      {activeClip.music.details}
                    </p>
                  </div>

                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    <strong className="text-zinc-800">Policy:</strong> CLIPX AI
                    never removes or replaces audio without your explicit permission.
                    Original source audio is preserved by default.
                  </p>

                  <label className="flex items-start gap-2 rounded-xl border border-zinc-200 p-2.5 text-xs text-zinc-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userPermittedMute}
                      onChange={(e) => setUserPermittedMute(e.target.checked)}
                      className="mt-0.5 rounded border-zinc-300 text-blue-600"
                    />
                    <span>
                      Optional: Mute audio track on the <em>new edited copy</em>{" "}
                      (keeps original clip untouched)
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={scanningMusic}
                    onClick={() => void handleRescanMusic()}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 transition"
                  >
                    {scanningMusic ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Re-Scan Audio with FFmpeg
                  </button>
                </div>
              )}

              {/* Render & Download Action Footer */}
              <div className="pt-4 border-t border-zinc-100 space-y-2.5">
                <button
                  type="button"
                  disabled={rendering}
                  onClick={() => void executeRender(false)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                >
                  {rendering ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      FFmpeg Rendering {aspectRatio} MP4...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Render Edited Clip ({aspectRatio} · {trimmedDuration}s MP4)
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => requestDownload(renderedClip || activeClip)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 transition"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download {renderedClip ? "Edited" : "Current"} MP4
                </button>
              </div>
            </div>
          </div>

          {/* Pre-Render Copyright Confirmation Modal */}
          {showRenderCopyrightModal && activeClip && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 backdrop-blur-[2px] p-4 animate-fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div className="w-full max-w-md rounded-2xl bg-white border border-zinc-200 shadow-elevated p-6">
                <div className="flex items-center gap-2.5 text-amber-700 font-bold text-sm">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <span>Copyrighted Music Detected</span>
                </div>
                <p className="mt-2 text-xs text-zinc-600 leading-relaxed">
                  <strong>{activeClip.title}</strong> contains potentially
                  copyrighted audio ({activeClip.music.confidence}% match risk).
                  CLIPX AI will{" "}
                  <strong>
                    {userPermittedMute
                      ? "mute the new edited copy per your explicit checkbox selection"
                      : "keep your original audio completely intact"}
                  </strong>
                  . Continue rendering?
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowRenderCopyrightModal(false)}
                    className="rounded-xl border border-zinc-200 px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void executeRender(true)}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Acknowledge & Render MP4
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </StudioShell>
  );
}

export default function VideoEditorPage() {
  return (
    <Suspense
      fallback={
        <StudioShell title="Video Editor">
          <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            Loading Video Editor...
          </div>
        </StudioShell>
      }
    >
      <VideoEditorInner />
    </Suspense>
  );
}
