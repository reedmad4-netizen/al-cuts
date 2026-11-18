import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportClipPairToDisk } from "@/lib/monitor-engine";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const ackCopyright = Boolean(body?.ackCopyright);
    const user = await getCurrentUser();

    const result = exportClipPairToDisk({
      clipId: id,
      userId: user?.id ?? null,
      ackCopyright,
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    if (result.status === "forbidden") {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
    if (result.status === "copyright_warning") {
      return NextResponse.json(
        {
          error: result.error,
          requiresCopyrightAck: true,
          originalClip: result.originalClip,
          shortClip: result.shortClip,
          music: result.originalClip.music,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      originalClip: result.originalClip,
      shortClip: result.shortClip,
      exportFiles: result.exportFiles,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to export Original + 9:16 Short pair.",
      },
      { status: 400 }
    );
  }
}
