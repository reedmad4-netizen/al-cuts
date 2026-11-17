import fs from "node:fs";
import { NextResponse } from "next/server";
import { canUserExportClip, getCurrentUser } from "@/lib/auth";
import {
  getDb,
  getEffectiveSettings,
  getExportsDir,
  mapClipRow,
  mapDownloadRow,
  stripInternalClipPaths,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const settings = getEffectiveSettings(user?.id ?? null);
  const db = getDb();

  const clipRows = db
    .prepare(
      `SELECT * FROM clips
       WHERE status = 'ready' AND (user_id IS NULL OR user_id = ?)
       ORDER BY created_at DESC`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const mappedClips = clipRows
    .map(mapClipRow)
    .filter((c) => settings.showDemoData || !c.isDemo);

  const pairedShortByOriginal = new Map<string, string>();
  for (const c of mappedClips) {
    if (
      c.parentClipId &&
      c.aspectRatio === "9:16" &&
      !pairedShortByOriginal.has(c.parentClipId)
    ) {
      pairedShortByOriginal.set(c.parentClipId, c.id);
    }
  }

  const exportableClips = mappedClips.map((c) => {
    const perm = canUserExportClip(c, user);
    return {
      ...stripInternalClipPaths(c),
      canExport: perm.allowed,
      exportNote: perm.reason,
      pairedShortId: pairedShortByOriginal.get(c.id) ?? null,
    };
  });

  const dlRows = db
    .prepare(
      `SELECT * FROM clip_downloads
       WHERE user_id IS NULL OR user_id = ?
       ORDER BY downloaded_at DESC
       LIMIT 40`
    )
    .all(user?.id ?? "__guest__") as Array<Record<string, unknown>>;

  const history = dlRows.map(mapDownloadRow);
  const exportsDir = getExportsDir();
  let exportFileCount = 0;
  try {
    if (fs.existsSync(exportsDir)) {
      exportFileCount = fs
        .readdirSync(exportsDir)
        .filter((f) => f.toLowerCase().endsWith(".mp4")).length;
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    clips: exportableClips,
    history,
    exportsDir,
    exportFileCount,
    warnBeforeCopyrightExport: settings.warnBeforeCopyrightExport,
    autoShortsEnabled: settings.autoShortsEnabled,
    autoDownloadEnabled: settings.autoDownloadEnabled,
    hypeThreshold: settings.hypeThreshold,
  });
}
