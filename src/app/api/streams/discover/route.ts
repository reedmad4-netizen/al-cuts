import { NextResponse } from "next/server";
import { discoverLiveGamingStreams } from "@/lib/live-sources";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limited = enforceRateLimit(req, "streams:discover", 40, 5 * 60_000);
  if (limited) return limited;
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
    const streams = await discoverLiveGamingStreams(q);
    return NextResponse.json({
      streams,
      query: q,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        streams: [],
        error:
          err instanceof Error
            ? err.message
            : "Could not load live stream directory.",
      },
      { status: 200 }
    );
  }
}
