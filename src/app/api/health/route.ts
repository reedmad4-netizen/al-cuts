import { NextResponse } from "next/server";
import { describeMediaToolchain } from "@/lib/ffmpeg";

export const dynamic = "force-dynamic";

/**
 * Deployment health probe. Surfaces the two failure modes that used to be
 * invisible: a missing FFmpeg/FFprobe toolchain, and an unconfigured session
 * secret (which silently generated a local one).
 */
export async function GET() {
  const toolchain = describeMediaToolchain();
  const secretConfigured = Boolean(
    (process.env.CLIPX_AUTH_SECRET || process.env.JWT_SECRET || "").trim()
  );

  return NextResponse.json(
    {
      ok: toolchain.ready,
      version: "1.7.0",
      media: {
        ready: toolchain.ready,
        ffmpeg: toolchain.ffmpeg,
        ffprobe: toolchain.ffprobe,
        hint: toolchain.ready
          ? null
          : "Video capture/editing is disabled: FFmpeg or FFprobe was not found. Install FFmpeg on PATH, set FFMPEG_PATH/FFPROBE_PATH, or re-run `npm install` with optional dependencies enabled.",
      },
      auth: {
        secretFromEnv: secretConfigured,
        hint: secretConfigured
          ? null
          : "No CLIPX_AUTH_SECRET set — a unique signing key was generated at data/auth-secret. Set the environment variable when running more than one instance.",
      },
    },
    { status: toolchain.ready ? 200 : 503 }
  );
}
