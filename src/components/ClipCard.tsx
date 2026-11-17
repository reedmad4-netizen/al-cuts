"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Download,
  Play,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useApp } from "./AppProvider";
import { MusicBadge, SourceBadge } from "./Badges";
import { ScoreBar, ScoreBreakdownPanel } from "./ScoreBar";
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";
import type { ClipRecord } from "@/lib/types";

export function ClipCard({
  clip,
  onDelete,
  onDownloaded,
}: {
  clip: ClipRecord;
  onDelete?: (id: string) => void;
  onDownloaded?: () => void;
}) {
  const { requestDownload, downloads } = useApp();
  const [playing, setPlaying] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const activeDl = downloads[clip.id];

  return (
    <>
      <div className="group flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-card hover:shadow-elevated hover:border-zinc-300 transition-all duration-200 overflow-hidden">
        {/* Video / Poster Stage */}
        <div className="relative aspect-video bg-zinc-950 overflow-hidden">
          {playing ? (
            <video
              src={clip.videoUrl}
              poster={clip.posterUrl}
              controls
              autoPlay
              playsInline
              className="h-full w-full object-contain bg-black"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="relative block h-full w-full text-left focus:outline-none"
              aria-label={`Play ${clip.title}`}
            >
              <img
                src={clip.posterUrl}
                alt={clip.title}
                className={`h-full w-full transition-transform duration-300 group-hover:scale-[1.03] ${
                  clip.aspectRatio === "9:16"
                    ? "object-contain bg-zinc-950"
                    : "object-cover"
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-black/25" />

              {/* Center Play Pill */}
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-zinc-950 shadow-lg transition-transform duration-200 group-hover:scale-110">
                  <Play className="h-4 w-4 fill-zinc-950 ml-0.5" />
                </span>
              </span>

              {/* Top Badges */}
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                <SourceBadge isDemo={clip.isDemo} size="xs" />
                {clip.parentClipId && clip.aspectRatio === "9:16" ? (
                  <span className="rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    AUTO 9:16 SHORT
                  </span>
                ) : clip.isEdited ? (
                  <span className="rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    EDITED
                  </span>
                ) : (
                  <span className="rounded-md bg-zinc-900/90 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    ORIGINAL {clip.aspectRatio}
                  </span>
                )}
              </div>

              {/* Bottom Meta */}
              <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-[11px] font-mono font-semibold text-white">
                <span className="rounded bg-black/70 px-1.5 py-0.5">
                  {clip.aspectRatio}
                </span>
                <span className="rounded bg-black/70 px-1.5 py-0.5">
                  {formatDuration(clip.durationSeconds)}
                </span>
              </div>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold text-zinc-950 leading-snug line-clamp-2">
              {clip.title}
            </h3>
          </div>

          <p className="mt-1 text-xs text-zinc-500 truncate">
            {clip.gameName} · {clip.channelName} · {formatRelativeTime(clip.createdAt)}
          </p>

          {/* AI Score Visual Progress Bar */}
          <div className="mt-3.5">
            <ScoreBar score={clip.aiScore} />
          </div>

          {/* Music + Buffer Meta */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5">
            <MusicBadge music={clip.music} compact />
            <span className="text-[11px] text-zinc-400 font-mono">
              {clip.isEdited
                ? formatBytes(clip.fileSizeBytes)
                : `-${Math.round(clip.preBufferSeconds)}s / +${Math.round(
                    clip.postBufferSeconds
                  )}s`}
            </span>
          </div>

          {/* Inline download progress when active */}
          {activeDl && activeDl.status === "downloading" && (
            <div className="mt-2.5">
              <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className="h-full bg-blue-600 rounded-full transition-all"
                  style={{ width: `${activeDl.progress}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] font-mono text-blue-600">
                Exporting MP4... {activeDl.progress}%
              </p>
            </div>
          )}

          {/* Action Row */}
          <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center gap-2">
            <Link
              href={`/editor?clip=${encodeURIComponent(clip.id)}`}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800 transition"
            >
              <Scissors className="h-3.5 w-3.5" />
              Edit
            </Link>
            <button
              type="button"
              onClick={() => requestDownload(clip, onDownloaded)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
            >
              <Download className="h-3.5 w-3.5" />
              MP4
            </button>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 p-2 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 transition"
              title="Inspect 5-Signal AI Score & Audio Analysis"
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(clip.id)}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 p-2 text-zinc-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition"
                title="Delete clip"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Score & Music Inspection Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 backdrop-blur-[2px] p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-zinc-200 shadow-elevated p-6">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <SourceBadge isDemo={clip.isDemo} />
                  <MusicBadge music={clip.music} />
                  <span className="text-xs font-mono text-zinc-500">
                    {clip.width}x{clip.height} ({clip.aspectRatio}) ·{" "}
                    {formatBytes(clip.fileSizeBytes)}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-zinc-950">{clip.title}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Trigger: {clip.triggerReason}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden bg-black aspect-video">
                  <video
                    src={clip.videoUrl}
                    poster={clip.posterUrl}
                    controls
                    playsInline
                    className="h-full w-full object-contain"
                  />
                </div>
                <div
                  className={`rounded-xl border p-3 text-xs ${
                    clip.music.flagged
                      ? "bg-amber-50/70 border-amber-200 text-amber-950"
                      : "bg-zinc-50 border-zinc-200 text-zinc-700"
                  }`}
                >
                  <p className="font-bold mb-1">
                    {clip.music.flagged
                      ? `Music Warning: ${
                          clip.music.trackMatch || "Potential Copyright Match"
                        }`
                      : "Audio Copyright Check: Clear"}
                  </p>
                  <p className="leading-relaxed opacity-90">
                    {clip.music.details}
                  </p>
                </div>
              </div>

              <ScoreBreakdownPanel
                scores={clip.scores}
                summary={clip.aiSummary}
              />
            </div>

            <div className="mt-5 pt-4 border-t border-zinc-100 flex items-center justify-end gap-2.5">
              <Link
                href={`/editor?clip=${encodeURIComponent(clip.id)}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 transition"
              >
                <Scissors className="h-3.5 w-3.5" />
                Open in Video Editor
              </Link>
              <button
                onClick={() => requestDownload(clip, onDownloaded)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
              >
                <Download className="h-3.5 w-3.5" />
                Export MP4
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
