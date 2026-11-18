"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Film, Loader2, Radio, Search } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { ClipCard } from "@/components/ClipCard";
import { StudioShell } from "@/components/StudioShell";
import type { ClipRecord } from "@/lib/types";

export default function ClipsPage() {
  const { notify, subscribeWs } = useApp();
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | "real" | "demo">("all");
  const [aspect, setAspect] = useState<"all" | "16:9" | "9:16" | "1:1">("all");
  const [music, setMusic] = useState<"all" | "clean" | "flagged">("all");
  const [minScore, setMinScore] = useState<number>(0);
  const [sort, setSort] = useState<"newest" | "score" | "duration">("newest");

  const loadClips = useCallback(async () => {
    const params = new URLSearchParams({
      source,
      aspect,
      music,
      minScore: String(minScore),
      sort,
      ...(query.trim() ? { q: query.trim() } : {}),
    });
    try {
      const res = await fetch(`/api/clips?${params.toString()}`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
      }
    } finally {
      setLoading(false);
    }
  }, [aspect, minScore, music, query, sort, source]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadClips();
    }, 120);
    return () => clearTimeout(t);
  }, [loadClips]);

  useEffect(() => {
    return subscribeWs((ev) => {
      if (ev === "clip_created") void loadClips();
    });
  }, [loadClips, subscribeWs]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/clips/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      notify({
        type: "error",
        title: "Delete failed",
        description: d.error || "Unable to remove clip.",
      });
      return;
    }
    setClips((prev) => prev.filter((c) => c.id !== id));
    notify({ type: "info", title: "Clip deleted from library" });
  }

  return (
    <StudioShell
      title="Generated Clips"
      subtitle="Browse, preview, score-inspect, edit, and download all automatically generated and edited clips"
      actions={
        <Link
          href="/monitoring"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition shadow-subtle"
        >
          <Radio className="h-3.5 w-3.5" />
          Generate New Clip
        </Link>
      }
    >
      {/* Filter Toolbar */}
      <div className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clips by title, game, channel, or event trigger..."
              className="w-full rounded-xl border border-zinc-200 pl-9 pr-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "all" | "real" | "demo")
              }
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">Source: All</option>
              <option value="real">Authorized Only</option>
              <option value="demo">Demo Samples</option>
            </select>

            <select
              value={aspect}
              onChange={(e) =>
                setAspect(e.target.value as "all" | "16:9" | "9:16" | "1:1")
              }
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">Ratio: All</option>
              <option value="16:9">16:9 Landscape</option>
              <option value="9:16">9:16 Vertical</option>
              <option value="1:1">1:1 Square</option>
            </select>

            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-blue-600 focus:outline-none"
            >
              <option value={0}>AI Score: Any</option>
              <option value={90}>Viral (90+)</option>
              <option value={80}>High (80+)</option>
              <option value={65}>Good (65+)</option>
            </select>

            <select
              value={music}
              onChange={(e) =>
                setMusic(e.target.value as "all" | "clean" | "flagged")
              }
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 focus:border-blue-600 focus:outline-none"
            >
              <option value="all">Audio: All</option>
              <option value="clean">Clean Audio</option>
              <option value="flagged">Music Flagged</option>
            </select>

            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as "newest" | "score" | "duration")
              }
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 focus:border-blue-600 focus:outline-none"
            >
              <option value="newest">Sort: Newest</option>
              <option value="score">Sort: Highest AI Score</option>
              <option value="duration">Sort: Longest</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading clip library...
        </div>
      ) : clips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-14 text-center">
          <Film className="h-8 w-8 text-zinc-300 mx-auto" />
          <h3 className="mt-3 text-sm font-bold text-zinc-950">
            No clips match your current filters
          </h3>
          <p className="mt-1 text-xs text-zinc-500 max-w-md mx-auto">
            {source === "real"
              ? "No authorized real-stream clips have been captured yet. Upload a gameplay file or connect an authorized HLS stream in Live Monitoring."
              : "Try clearing filters or capture a fresh highlight from Live Monitoring."}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSource("all");
                setAspect("all");
                setMusic("all");
                setMinScore(0);
              }}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
            >
              Reset Filters
            </button>
            <Link
              href="/monitoring"
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
            >
              Open Live Monitoring
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 animate-fade-in">
          {clips.map((clip) => (
            <ClipCard key={clip.id} clip={clip} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </StudioShell>
  );
}
