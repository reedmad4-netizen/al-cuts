import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, getEffectiveSettings } from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...settings } =
    getEffectiveSettings(user?.id ?? null);
  void rawTwitchToken;
  void rawYoutubeKey;
  void rawKickToken;

  let stats = { savedClips: 0, editedClips: 0, totalDownloads: 0 };
  if (user) {
    const db = getDb();
    const clipAgg = db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_edited = 1 THEN 1 ELSE 0 END) as edited
         FROM clips
         WHERE user_id = ? OR (? = 1 AND is_demo = 1)`
      )
      .get(user.id, user.isDemoAccount ? 1 : 0) as {
      total: number;
      edited: number | null;
    };
    const dlAgg = db
      .prepare("SELECT COUNT(*) as total FROM clip_downloads WHERE user_id = ?")
      .get(user.id) as { total: number };
    stats = {
      savedClips: clipAgg.total || 0,
      editedClips: clipAgg.edited || 0,
      totalDownloads: dlAgg.total || 0,
    };
  }

  return NextResponse.json({
    user,
    settings,
    stats,
    supabaseConfigured: isSupabaseConfigured(),
  });
}
