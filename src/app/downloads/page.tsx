"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FolderCheck,
  Loader2,
  Lock,
  Scissors,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { MusicBadge, SourceBadge } from "@/components/Badges";
import { ScoreBar } from "@/components/ScoreBar";
import { StudioShell } from "@/components/StudioShell";
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";
import type { ClipRecord, DownloadRecord } from "@/lib/types";

interface ExportableClip extends ClipRecord {
  canExport: boolean;
  exportNote: string;
  pairedShortId?: string | null;
}

export default function DownloadsPage() {
  const { requestDownload, requestDownloadPair, downloads, subscribeWs, notify } =
    useApp();
  const [clips, setClips] = useState<ExportableClip[]>([]);
  const [history, setHistory] = useState<DownloadRecord[]>([]);
  const [exportsDir, setExportsDir] = useState<string>("");
  const [exportFileCount, setExportFileCount] = useState<number>(0);
  const [pipelineInfo, setPipelineInfo] = useState<{
    hypeThreshold: number;
    autoShortsEnabled: boolean;
    autoDownloadEnabled: boolean;
  }>({ hypeThreshold: 70, autoShortsEnabled: true, autoDownloadEnabled: true });
  const [loading, setLoading] = useState(true);

  const loadDownloads = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setClips(data.clips || []);
      setHistory(data.history || []);
      setExportsDir(data.exportsDir || "");
      setExportFileCount(Number(data.exportFileCount || 0));
      setPipelineInfo({
        hypeThreshold: Number(data.hypeThreshold ?? 70),
        autoShortsEnabled: Boolean(data.autoShortsEnabled ?? true),
        autoDownloadEnabled: Boolean(data.autoDownloadEnabled ?? true),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDownloads();
  }, [loadDownloads]);

  useEffect(() => {
    return subscribeWs((ev) => {
      if (ev === "clip_created" || ev === "auto_download_bundle") {
        void loadDownloads();
      }
    });
  }, [loadDownloads, subscribeWs]);

  return (
    <StudioShell
      title="Downloads"
      subtitle="Export authorized MP4 video clips individually with live transfer progress and copyright verification"
    >
      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading authorized MP4 exports...
        </div>
      ) : (
        <div className="space-y-8 animate-fade-in">
          {/* Local Auto-Exports Folder Card (Original 16:9 + Paired 9:16 Shorts) */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-subtle flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5 min-w-0">
              <FolderCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="font-bold text-zinc-950">
                  Hands-Free Dual Export Folder ({exportFileCount} MP4
                  {exportFileCount === 1 ? "" : "s"} on disk)
                </p>
                <p className="text-zinc-600 mt-0.5 break-all">
                  Hype ≥ <strong>{pipelineInfo.hypeThreshold}/100</strong>{" "}
                  {pipelineInfo.autoShortsEnabled
                    ? "saves BOTH _ORIGINAL_16x9.mp4 & _SHORT_9x16.mp4"
                    : "saves _ORIGINAL_16x9.mp4"}{" "}
                  {pipelineInfo.autoDownloadEnabled
                    ? "to browser Downloads and:"
                    : "(auto-download paused; manual exports save to):"}
                </p>
                {exportsDir && (
                  <code className="mt-1 inline-block rounded-md bg-white border border-blue-200 px-2 py-0.5 font-mono text-[11px] text-zinc-900 break-all">
                    {exportsDir}
                  </code>
                )}
              </div>
            </div>
            {exportsDir && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(exportsDir);
                  notify({
                    type: "info",
                    title: "Copied Exports Folder Path",
                    description: exportsDir,
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition shrink-0"
              >
                <Copy className="h-3.5 w-3.5 text-blue-600" />
                Copy Folder Path
              </button>
            )}
          </div>

          {/* Export Policy Notice */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
              <span>
                <strong className="text-zinc-950">Authorized MP4 Exports:</strong>{" "}
                Only clips you own or have explicit export permission for can be
                downloaded. Copyright-flagged clips show a warning first and keep
                original audio untouched.
              </span>
            </div>
            <span className="font-mono font-semibold text-zinc-800">
              {clips.length} Ready · H.264/AAC MP4
            </span>
          </div>

          {/* Ready for MP4 Download List */}
          <section className="rounded-2xl border border-zinc-200 bg-white shadow-card overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h2 className="text-sm font-extrabold text-zinc-950">
                Available Individual MP4 Downloads
              </h2>
              <span className="text-xs text-zinc-500">
                Direct browser streaming download
              </span>
            </div>

            {clips.length === 0 ? (
              <div className="p-12 text-center text-xs text-zinc-500">
                No exportable clips available. Generate a clip on{" "}
                <Link
                  href="/monitoring"
                  className="font-semibold text-blue-600 underline"
                >
                  Live Monitoring
                </Link>
                .
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">
                {clips.map((clip) => {
                  const dl = downloads[clip.id];
                  return (
                    <div
                      key={clip.id}
                      className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-50/50 transition"
                    >
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <img
                          src={clip.posterUrl}
                          alt={clip.title}
                          className="h-14 w-24 rounded-xl object-cover bg-zinc-900 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <SourceBadge isDemo={clip.isDemo} size="xs" />
                            {clip.parentClipId && clip.aspectRatio === "9:16" ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                <Smartphone className="h-2.5 w-2.5" />
                                AUTO 9:16 SHORT
                              </span>
                            ) : !clip.isEdited ? (
                              <span className="rounded-md bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                ORIGINAL {clip.aspectRatio}
                              </span>
                            ) : (
                              <span className="rounded-md bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                                EDITED {clip.aspectRatio}
                              </span>
                            )}
                            <MusicBadge music={clip.music} compact />
                            <span className="font-mono text-[11px] text-zinc-500">
                              MP4 · {clip.width}×{clip.height} ({clip.aspectRatio}) ·{" "}
                              {formatDuration(clip.durationSeconds)} ·{" "}
                              {formatBytes(clip.fileSizeBytes)}
                            </span>
                          </div>

                          <h3 className="text-sm font-bold text-zinc-950 truncate">
                            {clip.title}
                          </h3>

                          <div className="mt-1.5 flex items-center gap-3 max-w-xs">
                            <div className="flex-1">
                              <ScoreBar
                                score={clip.aiScore}
                                compact
                                showLabel={false}
                              />
                            </div>
                            <span className="text-[11px] font-mono font-bold text-zinc-700">
                              AI {clip.aiScore}/100
                            </span>
                          </div>

                          {/* Per-row Live MP4 Download Progress Bar */}
                          {dl && (
                            <div className="mt-2.5 max-w-md">
                              <div className="flex justify-between text-[11px] font-mono mb-1">
                                <span
                                  className={
                                    dl.status === "done"
                                      ? "text-emerald-700 font-semibold"
                                      : dl.status === "error"
                                      ? "text-rose-600 font-semibold"
                                      : "text-blue-700 font-semibold"
                                  }
                                >
                                  {dl.status === "done"
                                    ? "Download complete"
                                    : dl.status === "error"
                                    ? dl.error
                                    : `Downloading MP4... ${dl.progress}%`}
                                </span>
                                {dl.totalBytes > 0 && (
                                  <span className="text-zinc-500">
                                    {formatBytes(dl.receivedBytes)} /{" "}
                                    {formatBytes(dl.totalBytes)}
                                  </span>
                                )}
                              </div>
                              <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-150 ${
                                    dl.status === "done"
                                      ? "bg-emerald-500"
                                      : dl.status === "error"
                                      ? "bg-rose-500"
                                      : "bg-blue-600"
                                  }`}
                                  style={{
                                    width: `${
                                      dl.status === "error" ? 100 : dl.progress
                                    }%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Row Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          href={`/editor?clip=${encodeURIComponent(clip.id)}`}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                        >
                          <Scissors className="h-3.5 w-3.5" />
                          Edit
                        </Link>
                        {clip.canExport && clip.pairedShortId && (
                          <button
                            type="button"
                            disabled={dl?.status === "downloading"}
                            onClick={() =>
                              void requestDownloadPair(clip.id, () =>
                                void loadDownloads()
                              )
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 transition"
                            title="Save & download BOTH the untouched 16:9 Original MP4 and paired 9:16 Short MP4"
                          >
                            <Smartphone className="h-3.5 w-3.5 text-blue-400" />
                            Both (16:9 + 9:16)
                          </button>
                        )}
                        {clip.canExport ? (
                          <button
                            type="button"
                            disabled={dl?.status === "downloading"}
                            onClick={() =>
                              requestDownload(clip, () => void loadDownloads())
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                          >
                            {dl?.status === "downloading" ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {dl.progress}%
                              </>
                            ) : (
                              <>
                                <Download className="h-3.5 w-3.5" />
                                Download MP4
                              </>
                            )}
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-500"
                            title={clip.exportNote}
                          >
                            <Lock className="h-3.5 w-3.5" />
                            Owner Only
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Persisted Export History Table */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-zinc-500" />
              <h2 className="text-sm font-extrabold text-zinc-950">
                MP4 Export History ({history.length})
              </h2>
            </div>

            {history.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4">
                No MP4 files downloaded yet. Click Download MP4 on any clip above
                to export and record history.
              </p>
            ) : (
              <div className="space-y-2">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <SourceBadge isDemo={h.isDemo} size="xs" />
                      <span className="font-semibold text-zinc-900 truncate">
                        {h.clipTitle}
                      </span>
                      {h.savedExportPath && (
                        <code className="hidden md:inline rounded bg-white border border-zinc-200 px-1.5 py-0.5 font-mono text-[10px] text-blue-700 truncate max-w-xs">
                          {h.savedExportPath}
                        </code>
                      )}
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500">
                      <span>
                        {h.format.toUpperCase()} · {h.aspectRatio}
                      </span>
                      <span>{formatBytes(h.fileSizeBytes)}</span>
                      {h.copyrightAcknowledged && (
                        <span className="text-amber-700 font-sans font-semibold">
                          Warning Ack
                        </span>
                      )}
                      <span>{formatRelativeTime(h.downloadedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </StudioShell>
  );
}
