import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import { getDb, mapClipRow, stripInternalClipPaths } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }
  return NextResponse.json({
    clip: stripInternalClipPaths(mapClipRow(row)),
  });
}

const PatchClipSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  saveToAccount: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const parsed = PatchClipSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid update." }, { status: 400 });
    }
    const user = await getCurrentUser();
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM clips WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json({ error: "Clip not found." }, { status: 404 });
    }
    const clip = mapClipRow(row);
    const access = canUserExportClip(clip, user);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    if (parsed.data.title) {
      db.prepare("UPDATE clips SET title = ? WHERE id = ?").run(
        parsed.data.title.trim(),
        id
      );
    }
    if (parsed.data.saveToAccount) {
      if (!user) {
        return NextResponse.json(
          { error: "Sign in to save clips to your account library." },
          { status: 401 }
        );
      }
      db.prepare("UPDATE clips SET user_id = ? WHERE id = ?").run(
        user.id,
        id
      );
    }

    const updated = mapClipRow(
      db.prepare("SELECT * FROM clips WHERE id = ?").get(id) as Record<
        string,
        unknown
      >
    );
    return NextResponse.json({ clip: stripInternalClipPaths(updated) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM clips WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) {
    return NextResponse.json({ error: "Clip not found." }, { status: 404 });
  }
  const clip = mapClipRow(row);
  const access = canUserExportClip(clip, user);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: 403 });
  }

  // Only delete generated/edited files on disk; keep shared sample seed files intact
  const generatedRoot = path.resolve(process.cwd(), "public/media/generated");
  if (
    clip.filePath.startsWith(generatedRoot + path.sep) &&
    fs.existsSync(clip.filePath)
  ) {
    fs.rmSync(clip.filePath, { force: true });
  }
  if (
    clip.posterPath.startsWith(generatedRoot + path.sep) &&
    fs.existsSync(clip.posterPath)
  ) {
    fs.rmSync(clip.posterPath, { force: true });
  }

  db.prepare("DELETE FROM clips WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
