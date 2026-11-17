import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  mapChatRow,
  mapStreamRow,
  mapSurgeRow,
} from "@/lib/db";
import {
  executeClipCapture,
  getAllBufferStates,
  getStreamVelocityHistory,
  injectDemoChatBurst,
  startStreamMonitoring,
} from "@/lib/monitor-engine";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  const settings = getEffectiveSettings(user?.id ?? null);
  const { searchParams } = new URL(req.url);
  const streamId = searchParams.get("streamId") || "stream-demo-sandbox";

  const db = getDb();
  const streamRows = db
    .prepare(
      `SELECT * FROM streams
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY is_demo ASC, created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;
  const streams = streamRows.map(mapStreamRow);

  const msgRows = db
    .prepare(
      `SELECT * FROM chat_messages
       WHERE stream_id = ?
       ORDER BY created_at DESC
       LIMIT 80`
    )
    .all(streamId) as Array<Record<string, unknown>>;
  const messages = msgRows.map(mapChatRow).reverse();

  const surgeRows = db
    .prepare(
      `SELECT * FROM chat_surges
       WHERE stream_id = ?
       ORDER BY created_at DESC
       LIMIT 15`
    )
    .all(streamId) as Array<Record<string, unknown>>;
  const surges = surgeRows.map(mapSurgeRow);

  // Aggregate top detected hype keywords
  const keywordCounts: Record<string, number> = {};
  for (const m of messages) {
    for (const k of m.matchedKeywords) {
      keywordCounts[k] = (keywordCounts[k] || 0) + 1;
    }
  }
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([keyword, count]) => ({ keyword, count }));

  return NextResponse.json({
    streamId,
    streams,
    messages,
    surges,
    topKeywords,
    velocityHistory: getStreamVelocityHistory(streamId),
    buffer: getAllBufferStates()[streamId] || null,
    spikeMultiplierThreshold: settings.chatSpikeMultiplier,
  });
}

const PostChatSchema = z.object({
  streamId: z.string(),
  mode: z.enum(["message", "burst", "burst_and_clip"]).default("message"),
  author: z.string().max(32).optional(),
  message: z.string().max(240).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = PostChatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
    }

    const user = await getCurrentUser();
    const db = getDb();
    const streamRow = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(parsed.data.streamId) as Record<string, unknown> | undefined;
    if (!streamRow) {
      return NextResponse.json({ error: "Stream not found." }, { status: 404 });
    }
    const stream = mapStreamRow(streamRow);
    if (!stream.isDemo) {
      return NextResponse.json(
        {
          error:
            "Test chat simulation is only available on the Demo Sandbox stream. Real streams ingest read-only messages from official APIs.",
        },
        { status: 400 }
      );
    }

    if (parsed.data.mode === "message" && parsed.data.message?.trim()) {
      const res = injectDemoChatBurst(parsed.data.streamId, [
        parsed.data.message.trim(),
      ]);
      return NextResponse.json({ ok: true, ...res });
    }

    if (parsed.data.mode === "burst") {
      if (stream.status === "ready") {
        await startStreamMonitoring(stream.id, user?.id ?? null);
      }
      const res = injectDemoChatBurst(parsed.data.streamId);
      return NextResponse.json({ ok: true, ...res });
    }

    // burst_and_clip: triggers hype spike + automatic AI clip evaluation & FFmpeg 20s-buffer capture
    if (stream.status === "ready") {
      await startStreamMonitoring(stream.id, user?.id ?? null);
    }
    const capture = await executeClipCapture({
      streamId: stream.id,
      userId: user?.id ?? null,
      scenario: "clutch",
    });
    return NextResponse.json(capture);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat action failed." },
      { status: 400 }
    );
  }
}
