"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Film,
  Loader2,
  Music,
  Plus,
  Radio,
  Scissors,
  Sparkles,
  Download,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { MusicBadge, SourceBadge, StreamStatusBadge } from "@/components/Badges";
import { ClipCard } from "@/components/ClipCard";
import { ScoreBar } from "@/components/ScoreBar";
import { StudioShell } from "@/components/StudioShell";
import { formatDuration, formatRelativeTime, platformLabel } from "@/lib/format";
import type {
  ChatSurgeRecord,
  ClipRecord,
  ProcessingJob,
  StreamRecord,
} from "@/lib/types";

interface DashboardData {
  metrics: {
    totalClips: number;
    realClipsCount: number;
    demoClipsCount: number;
    liveRealStreamsMonitored: number;
    demoStreamsActive: number;
    totalRegisteredStreams: number;
    highScoringCount: number;
    avgAiScore: number;
    musicWarningsCount: number;
    runningJobsCount: number;
  };
  highScoringClips: ClipRecord[];
  recentClips: ClipRecord[];
  musicWarnings: ClipRecord[];
  streams: StreamRecord[];
  surges: ChatSurgeRecord[];
  jobs: ProcessingJob[];
  showDemoData: boolean;
}

export default function DashboardPage() {
  const { subscribeWs, requestDownload, jobs: liveJobs } = useApp();
  const [scope, setScope] = useState<"all" | "real" | "demo">("all");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard?scope=${scope}`, {
        cache: "no-store",
      });
      if (res.ok) {
        setData(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    setLoading(true);
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    return subscribeWs((event) => {
      if (
        event === "clip_created" ||
        event === "stream_updated" ||
        event === "chat_surge" ||
        event === "buffer_stopped"
      ) {
        void loadDashboard();
      }
    });
  }, [loadDashboard, subscribeWs]);

  const mergedJobs =
    liveJobs.length > 0 ? liveJobs.slice(0, 5) : data?.jobs || [];

  return (
    <StudioShell
      title="Dashboard"
      subtitle="Overview of monitored streams, AI-scored highlights, processing queue, and copyright flags"
      actions={
        <Link
          href="/monitoring"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition shadow-subtle"
        >
          <Plus className="h-3.5 w-3.5" />
          Monitor Stream
        </Link>
      }
    >
      {/* Data Source Filter Bar — Transparent Demo vs Real Separation */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-white p-1 shadow-subtle">
          {(
            [
              { id: "all", label: "All Data" },
              { id: "real", label: "Authorized Streams Only" },
              { id: "demo", label: "Demo Sample Data" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setScope(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                scope === tab.id
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-600 hover:text-zinc-950"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {data && data.metrics.liveRealStreamsMonitored === 0 && (
          <p className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-700">
              No live external streams connected.
            </span>{" "}
            Sample records are clearly marked <strong className="text-amber-700">DEMO</strong>.
          </p>
        )}
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-24 text-zinc-500 text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading CLIPX AI dashboard...
        </div>
      ) : data ? (
        <div className="space-y-8 animate-fade-in">
          {/* KPI Metrics Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
                <span>Total Clips Generated</span>
                <Film className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-2.5 text-3xl font-extrabold tracking-tight text-zinc-950">
                {data.metrics.totalClips}
              </p>
              <p className="mt-1.5 text-xs text-zinc-500">
                <span className="font-semibold text-emerald-700">
                  {data.metrics.realClipsCount} authorized
                </span>{" "}
                ·{" "}
                <span className="font-medium text-amber-700">
                  {data.metrics.demoClipsCount} demo
                </span>
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
                <span>Live Streams Monitored</span>
                <Radio className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-2.5 text-3xl font-extrabold tracking-tight text-zinc-950">
                {data.metrics.liveRealStreamsMonitored}
              </p>
              <p className="mt-1.5 text-xs text-zinc-500">
                {data.metrics.demoStreamsActive > 0 ? (
                  <span className="font-semibold text-blue-600">
                    Demo 20s buffer active
                  </span>
                ) : (
                  <span>
                    {data.metrics.totalRegisteredStreams} source
                    {data.metrics.totalRegisteredStreams === 1 ? "" : "s"}{" "}
                    configured
                  </span>
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
                <span>High-Scoring Clips (80+)</span>
                <Sparkles className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-2.5 text-3xl font-extrabold tracking-tight text-zinc-950">
                {data.metrics.highScoringCount}
              </p>
              <p className="mt-1.5 text-xs text-zinc-500">
                Avg AI Score:{" "}
                <span className="font-mono font-bold text-zinc-900">
                  {data.metrics.avgAiScore}/100
                </span>
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
                <span>Music & Copyright Flags</span>
                <Music className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-2.5 text-3xl font-extrabold tracking-tight text-zinc-950">
                {data.metrics.musicWarningsCount}
              </p>
              <p className="mt-1.5 text-xs text-zinc-500">
                {data.metrics.runningJobsCount > 0 ? (
                  <span className="font-semibold text-blue-600">
                    {data.metrics.runningJobsCount} FFmpeg job encoding...
                  </span>
                ) : (
                  <span>Processing pipeline idle · Audio intact</span>
                )}
              </p>
            </div>
          </div>

          {/* Processing Status + Music/Copyright Warnings */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Processing & Stream Status Card */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm font-bold text-zinc-950">
                    Stream & FFmpeg Processing Status
                  </h2>
                </div>
                <Link
                  href="/monitoring"
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                >
                  Manage <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="space-y-2.5">
                {data.streams.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <SourceBadge isDemo={s.isDemo} size="xs" />
                        <span className="text-xs font-bold text-zinc-900 truncate">
                          {s.channelName}
                        </span>
                        <span className="text-[11px] text-zinc-400">
                          · {platformLabel(s.platform)}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                        20s rolling buffer · +{s.postBufferSeconds}s post-event
                      </p>
                    </div>
                    <StreamStatusBadge status={s.status} isDemo={s.isDemo} />
                  </div>
                ))}

                {mergedJobs.length > 0 ? (
                  <div className="pt-2 space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                      Recent Processing Pipeline Jobs
                    </p>
                    {mergedJobs.slice(0, 3).map((j) => (
                      <div
                        key={j.id}
                        className="rounded-xl border border-zinc-200/80 px-3.5 py-2.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-zinc-900 truncate">
                            {j.title}
                          </span>
                          <span
                            className={`font-mono text-[11px] font-bold ${
                              j.status === "failed"
                                ? "text-rose-600"
                                : j.status === "completed"
                                ? "text-emerald-600"
                                : "text-blue-600"
                            }`}
                          >
                            {j.status === "completed"
                              ? "Ready"
                              : j.status === "failed"
                              ? "Failed"
                              : `${j.progress}%`}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {j.error || j.stage}
                        </p>
                        {j.status === "running" && (
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full transition-all"
                              style={{ width: `${j.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-200 p-3.5 text-xs text-zinc-500">
                    FFmpeg encoder ready. Start monitoring on{" "}
                    <Link
                      href="/monitoring"
                      className="font-semibold text-blue-600 underline"
                    >
                      Live Monitoring
                    </Link>{" "}
                    to auto-capture new 20s rolling-buffer clips.
                  </div>
                )}
              </div>
            </div>

            {/* Music & Copyright Warnings Card */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <h2 className="text-sm font-bold text-zinc-950">
                    Music & Copyright Warnings
                  </h2>
                </div>
                <span className="text-[11px] font-medium text-zinc-500">
                  Audio never altered automatically
                </span>
              </div>

              {data.musicWarnings.length === 0 ? (
                <div className="rounded-xl bg-zinc-50 border border-zinc-200/70 p-5 text-center">
                  <p className="text-xs font-semibold text-zinc-800">
                    No copyright music warnings in current view
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    All visible clips passed acoustic mid-band harmony checks.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.musicWarnings.map((clip) => (
                    <div
                      key={clip.id}
                      className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <SourceBadge isDemo={clip.isDemo} size="xs" />
                            <span className="text-[11px] font-bold text-amber-800">
                              {clip.music.confidence}% Match Risk
                            </span>
                          </div>
                          <p className="text-xs font-bold text-zinc-950 truncate">
                            {clip.title}
                          </p>
                          <p className="text-[11px] text-amber-900/80 mt-0.5 line-clamp-2">
                            {clip.music.trackMatch || clip.music.details}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Link
                            href={`/editor?clip=${encodeURIComponent(clip.id)}`}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-900 hover:bg-amber-50 transition"
                          >
                            Review
                          </Link>
                          <button
                            type="button"
                            onClick={() => requestDownload(clip)}
                            className="rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 transition"
                          >
                            Export
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* High-Scoring Clips Showcase */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-extrabold text-zinc-950">
                  High-Scoring AI Clips
                </h2>
                <p className="text-xs text-zinc-500">
                  Top highlights ranked 80–100 across chat surges, gameplay intensity, and reactions
                </p>
              </div>
              <Link
                href="/clips"
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                View all clips <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {data.highScoringClips.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
                <p className="text-sm font-bold text-zinc-900">
                  {scope === "real"
                    ? "No authorized real-stream clips generated yet"
                    : "No high-scoring clips yet"}
                </p>
                <p className="mt-1 text-xs text-zinc-500 max-w-md mx-auto">
                  Connect an authorized HLS stream or upload your own gameplay
                  video on Live Monitoring to automatically detect and generate
                  real scored MP4 clips.
                </p>
                <Link
                  href="/monitoring"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
                >
                  <Radio className="h-3.5 w-3.5" />
                  Go to Live Monitoring
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {data.highScoringClips.slice(0, 3).map((clip) => (
                  <ClipCard key={clip.id} clip={clip} />
                ))}
              </div>
            )}
          </section>

          {/* Recent Clips Table */}
          {data.recentClips.length > 0 && (
            <section className="rounded-2xl border border-zinc-200 bg-white shadow-card overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
                <h2 className="text-sm font-extrabold text-zinc-950">
                  Recent Clips Feed
                </h2>
                <Link
                  href="/downloads"
                  className="text-xs font-semibold text-zinc-600 hover:text-zinc-950"
                >
                  Open Downloads
                </Link>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50/80 text-zinc-500 border-b border-zinc-100">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Clip</th>
                      <th className="px-4 py-3 font-semibold">Source</th>
                      <th className="px-4 py-3 font-semibold w-44">AI Score</th>
                      <th className="px-4 py-3 font-semibold">Audio Status</th>
                      <th className="px-4 py-3 font-semibold">Format</th>
                      <th className="px-5 py-3 font-semibold text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.recentClips.map((c) => (
                      <tr key={c.id} className="hover:bg-zinc-50/60 transition">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <img
                              src={c.posterUrl}
                              alt=""
                              className="h-10 w-16 rounded-lg object-cover bg-zinc-900 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="font-bold text-zinc-950 truncate max-w-[230px]">
                                {c.title}
                              </p>
                              <p className="text-[11px] text-zinc-500">
                                {c.gameName} · {formatRelativeTime(c.createdAt)}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <SourceBadge isDemo={c.isDemo} size="xs" />
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-24">
                              <ScoreBar
                                score={c.aiScore}
                                compact
                                showLabel={false}
                              />
                            </div>
                            <span className="font-mono font-bold text-zinc-900">
                              {c.aiScore}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <MusicBadge music={c.music} compact />
                        </td>
                        <td className="px-4 py-3.5 font-mono text-zinc-600">
                          {c.aspectRatio} · {formatDuration(c.durationSeconds)}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              href={`/editor?clip=${encodeURIComponent(c.id)}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1.5 font-semibold text-zinc-800 hover:bg-zinc-100 transition"
                            >
                              <Scissors className="h-3 w-3" />
                              Edit
                            </Link>
                            <button
                              type="button"
                              onClick={() => requestDownload(c)}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 font-semibold text-white hover:bg-blue-700 transition"
                            >
                              <Download className="h-3 w-3" />
                              MP4
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      ) : null}
    </StudioShell>
  );
}
