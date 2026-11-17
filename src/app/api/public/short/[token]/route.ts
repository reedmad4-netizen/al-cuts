import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb, mapClipRow } from "@/lib/db";
import { fileStream } from "@/lib/file-stream";
import { verifyMediaToken } from "@/lib/public-media";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

/**
 * Public, unauthenticated media endpoint used by Instagram to fetch a Reel.
 *
 * Access is granted only by the signed token in the path (specific clip, short
 * TTL). Nothing here reads a user-supplied path, so there is no traversal
 * surface: the token names a clip id, and the file comes from that row.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const check = verifyMediaToken(token);
  if (!check.ok) {
    const message =
      check.reason === "expired"
        ? "This media link has expired. Re-publish to generate a new one."
        : "Invalid media link.";
    return NextResponse.json({ error: message }, { status: 403 });
  }

  const row = getDb()
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(check.grant.clipId) as Record<string, unknown> | undefined;

  if (!row) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }

  const clip = mapClipRow(row);
  if (!clip.filePath || !fs.existsSync(clip.filePath)) {
    return NextResponse.json({ error: "Video file is missing." }, { status: 404 });
  }

  const stat = fs.statSync(clip.filePath);
  if (!stat.isFile()) {
    return NextResponse.json({ error: "Video file is missing." }, { status: 404 });
  }

  const ext = path.extname(clip.filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || "video/mp4";
  const range = req.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }

    return new NextResponse(fileStream(clip.filePath, { start, end }), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        // The token itself is the authorization, so shared caches must not keep it.
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  }

  return new NextResponse(fileStream(clip.filePath), {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

/** Instagram sometimes probes with HEAD before downloading. */
export async function HEAD(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  const res = await GET(req, ctx);
  return new NextResponse(null, {
    status: res.status,
    headers: res.headers,
  });
}
