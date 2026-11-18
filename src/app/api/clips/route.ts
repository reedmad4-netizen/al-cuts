import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapClipRow,
  stripInternalClipPaths,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const settings = getEffectiveSettings(user?.id ?? null);
  const { searchParams } = new URL(req.url);

  const source = searchParams.get("source") || "default"; // default | all | real | demo
  const aspect = searchParams.get("aspect") || "all"; // all | 16:9 | 9:16 | 1:1
  const music = searchParams.get("music") || "all"; // all | flagged | clean
  const minScore = Number(searchParams.get("minScore") || 0);
  const query = (searchParams.get("q") || "").trim().toLowerCase();
  const sort = searchParams.get("sort") || "newest"; // newest | score | duration

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM clips
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  let clips = rows.map((r) => stripInternalClipPaths(mapClipRow(r)));

  if (source === "real") {
    clips = clips.filter((c) => !c.isDemo);
  } else if (source === "demo") {
    clips = clips.filter((c) => c.isDemo);
  } else if (source === "default" && !settings.showDemoData) {
    clips = clips.filter((c) => !c.isDemo);
  }

  if (aspect !== "all") {
    clips = clips.filter((c) => c.aspectRatio === aspect);
  }
  if (music === "flagged") {
    clips = clips.filter((c) => c.music.flagged);
  } else if (music === "clean") {
    clips = clips.filter((c) => !c.music.flagged);
  }
  if (minScore > 0) {
    clips = clips.filter((c) => c.aiScore >= minScore);
  }
  if (query) {
    clips = clips.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.gameName.toLowerCase().includes(query) ||
        c.channelName.toLowerCase().includes(query) ||
        c.triggerReason.toLowerCase().includes(query)
    );
  }

  if (sort === "score") {
    clips.sort((a, b) => b.aiScore - a.aiScore);
  } else if (sort === "duration") {
    clips.sort((a, b) => b.durationSeconds - a.durationSeconds);
  } else {
    clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return NextResponse.json({
    clips,
    showDemoData: settings.showDemoData,
  });
}
