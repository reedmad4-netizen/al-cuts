import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { fileStream } from "@/lib/file-stream";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const mediaRoot = path.resolve(process.cwd(), "public/media");
  const joined = path.resolve(mediaRoot, ...(pathSegments || []));

  // Prevent directory traversal
  if (!joined.startsWith(mediaRoot + path.sep)) {
    return NextResponse.json({ error: "Forbidden path." }, { status: 403 });
  }

  if (!fs.existsSync(joined) || !fs.statSync(joined).isFile()) {
    return NextResponse.json({ error: "Media file not found." }, { status: 404 });
  }

  const stat = fs.statSync(joined);
  const ext = path.extname(joined).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || "application/octet-stream";
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

    const chunkSize = end - start + 1;

    return new NextResponse(fileStream(joined, { start, end }), {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=60",
      },
    });
  }

  return new NextResponse(fileStream(joined), {
    status: 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}
