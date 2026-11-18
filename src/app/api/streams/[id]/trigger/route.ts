import { NextResponse } from "next/server";
import { z } from "zod";
import { canTriggerStream, getCurrentUser } from "@/lib/auth";
import {
  executeClipCapture,
  startStreamMonitoring,
} from "@/lib/monitor-engine";
import { getDb, mapStreamRow } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const TriggerSchema = z.object({
  scenario: z
    .enum(["clutch", "music_record", "manual", "authorized_auto", "dedupe_check"])
    .default("clutch"),
  eventTimeSec: z.number().min(0).max(7200).optional(),
  bypassCooldown: z.boolean().optional(),
  createShortOverride: z.boolean().optional(),
  autoDownloadOverride: z.boolean().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const limited = enforceRateLimit(req, "streams:trigger", 20, 5 * 60_000);
  if (limited) return limited;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = TriggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid trigger parameters." },
        { status: 400 }
      );
    }

    const user = await getCurrentUser();
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json({ error: "Stream not found." }, { status: 404 });
    }
    const stream = mapStreamRow(row);

    const access = canTriggerStream(stream, user);
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason },
        { status: user ? 403 : 401 }
      );
    }

    // Ensure monitoring buffer is running if stream is ready
    if (stream.status === "ready") {
      await startStreamMonitoring(id, user?.id ?? null);
    }

    const mappedScenario =
      parsed.data.scenario === "dedupe_check" ? "clutch" : parsed.data.scenario;

    const result = await executeClipCapture({
      streamId: id,
      userId: user?.id ?? null,
      scenario: mappedScenario,
      bypassCooldown:
        parsed.data.scenario === "dedupe_check"
          ? false
          : Boolean(parsed.data.bypassCooldown),
      customEventTimeSec: parsed.data.eventTimeSec,
      createShortOverride: parsed.data.createShortOverride,
      autoDownloadOverride: parsed.data.autoDownloadOverride,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to capture clip from stream.",
      },
      { status: 400 }
    );
  }
}
