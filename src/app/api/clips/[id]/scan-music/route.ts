import { NextResponse } from "next/server";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import { getDb, mapClipRow, stripInternalClipPaths } from "@/lib/db";
import { analyzeMusicCopyright } from "@/lib/ffmpeg";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM clips WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }
    const clip = mapClipRow(row);

    const user = await getCurrentUser();
    const access = canUserExportClip(clip, user);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    // Non-destructive FFmpeg DSP & Chromaprint music scan (never touches audio stream)
    const music = await analyzeMusicCopyright(clip.filePath);

    db.prepare(
      `UPDATE clips
       SET music_flagged = ?, music_confidence = ?, music_track_match = ?,
           music_details = ?, music_rms_db = ?, music_crest_factor = ?
       WHERE id = ?`
    ).run(
      music.flagged ? 1 : 0,
      music.confidence,
      music.trackMatch,
      music.details,
      music.rmsDb,
      music.crestFactor,
      id
    );

    const updated = stripInternalClipPaths(
      mapClipRow(
        db
          .prepare("SELECT * FROM clips WHERE id = ?")
          .get(id) as Record<string, unknown>
      )
    );

    return NextResponse.json({ clip: updated, music });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Music detection scan failed.",
      },
      { status: 500 }
    );
  }
}
