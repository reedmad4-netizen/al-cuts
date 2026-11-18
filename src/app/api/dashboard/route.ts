import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapClipRow,
  mapStreamRow,
  mapSurgeRow,
  stripInternalClipPaths,
} from "@/lib/db";
import { getAllBufferStates, getRecentJobs } from "@/lib/monitor-engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const settings = getEffectiveSettings(user?.id ?? null);
  const { searchParams } = new URL(req.url);
  const scope = searchParams.get("scope") || "default"; // all | real | demo | default

  const db = getDb();
  const includeDemo =
    scope === "real" ? false : scope === "demo" || scope === "all" ? true : settings.showDemoData;
  const onlyDemo = scope === "demo";

  const allClipRows = db
    .prepare(
      `SELECT * FROM clips
       WHERE (user_id IS NULL OR user_id = ?)
       ORDER BY created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const clips = allClipRows
    .map((r) => stripInternalClipPaths(mapClipRow(r)))
    .filter((c) => {
      if (onlyDemo) return c.isDemo;
      if (!includeDemo && c.isDemo) return false;
      return true;
    });

  const streamRows = db
    .prepare(
      `SELECT * FROM streams
       WHERE (user_id IS NULL OR user_id = ?)
       ORDER BY is_demo ASC, created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const streams = streamRows.map(mapStreamRow).filter((s) => {
    if (onlyDemo) return s.isDemo;
    if (!includeDemo && s.isDemo) return false;
    return true;
  });

  const surgeRows = db
    .prepare("SELECT * FROM chat_surges ORDER BY created_at DESC LIMIT 8")
    .all() as Array<Record<string, unknown>>;
  const surges = surgeRows.map(mapSurgeRow).filter((s) => {
    if (onlyDemo) return s.isDemo;
    if (!includeDemo && s.isDemo) return false;
    return true;
  });

  const liveRealMonitoring = streams.filter(
    (s) => !s.isDemo && s.status === "monitoring"
  ).length;
  const demoMonitoring = streams.filter(
    (s) => s.isDemo && s.status === "monitoring"
  ).length;
  const realClipsCount = clips.filter((c) => !c.isDemo).length;
  const demoClipsCount = clips.filter((c) => c.isDemo).length;
  const highScoringClips = [...clips]
    .filter((c) => c.aiScore >= 80)
    .sort((a, b) => b.aiScore - a.aiScore);
  const musicWarnings = clips.filter((c) => c.music.flagged);
  const avgAiScore = clips.length
    ? Math.round(clips.reduce((acc, c) => acc + c.aiScore, 0) / clips.length)
    : 0;

  const jobs = getRecentJobs();
  const runningJobs = jobs.filter((j) => j.status === "running").length;

  return NextResponse.json({
    metrics: {
      totalClips: clips.length,
      realClipsCount,
      demoClipsCount,
      liveRealStreamsMonitored: liveRealMonitoring,
      demoStreamsActive: demoMonitoring,
      totalRegisteredStreams: streams.length,
      highScoringCount: highScoringClips.length,
      avgAiScore,
      musicWarningsCount: musicWarnings.length,
      runningJobsCount: runningJobs,
    },
    highScoringClips: highScoringClips.slice(0, 4),
    recentClips: clips.slice(0, 6),
    musicWarnings: musicWarnings.slice(0, 5),
    streams,
    surges,
    jobs: jobs.slice(0, 6),
    buffers: getAllBufferStates(),
    showDemoData: settings.showDemoData,
  });
}
