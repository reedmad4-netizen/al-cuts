import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, getSocialSettings } from "@/lib/db";
import { buildPublicMediaUrl, hostingWarning } from "@/lib/public-media";
import { testStorage, type S3Config } from "@/lib/s3";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Proves that Instagram will be able to download a video.
 *
 * - bucket mode: uploads a tiny object and reads it back.
 * - built-in mode: fetches this app through its own public URL, including a
 *   real signed media link, which is exactly what Meta does.
 */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "social:storage-test", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to test storage." }, { status: 401 });
  }

  const settings = getSocialSettings(user.id);

  if (settings.storageMode === "builtin") {
    if (!settings.publicBaseUrl) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Set this app's public URL first (the address Instagram will use to reach it).",
        },
        { status: 400 }
      );
    }

    const warning = hostingWarning(settings.publicBaseUrl);
    const base = settings.publicBaseUrl.replace(/\/+$/, "");

    let healthOk = false;
    let healthDetail = "";
    try {
      const res = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      healthOk = res.ok;
      healthDetail = `HTTP ${res.status}`;
    } catch (err) {
      healthDetail =
        err instanceof Error ? (err.cause as Error | undefined)?.message || err.message : "unreachable";
    }

    if (!healthOk) {
      return NextResponse.json(
        {
          ok: false,
          mode: "builtin",
          publicBaseUrl: base,
          error: `This server could not reach ${base}/api/health (${healthDetail}). Check the public URL, DNS and firewall — Instagram has to reach it over the internet.`,
        },
        { status: 400 }
      );
    }

    // Strongest possible check: sign a real link for the newest clip and fetch it.
    const row = getDb()
      .prepare(
        "SELECT id FROM clips WHERE user_id = ? AND file_path IS NOT NULL AND file_path != '' ORDER BY created_at DESC LIMIT 1"
      )
      .get(user.id) as { id?: string } | undefined;

    if (!row?.id) {
      return NextResponse.json({
        ok: true,
        mode: "builtin",
        publicBaseUrl: base,
        warning,
        detail:
          "This URL is reachable. Generate a clip, then test again to verify a video can actually be downloaded.",
      });
    }

    const link = buildPublicMediaUrl(base, row.id, 300);
    try {
      const res = await fetch(link.url, {
        headers: { Range: "bytes=0-2047" },
        signal: AbortSignal.timeout(20_000),
      });
      const type = res.headers.get("content-type") || "";
      if (!res.ok || !type.startsWith("video/")) {
        return NextResponse.json(
          {
            ok: false,
            mode: "builtin",
            error: `Signed link returned HTTP ${res.status} (${type || "no content type"}). If a proxy strips query strings or blocks /api, put the app behind HTTPS without rewriting paths.`,
          },
          { status: 400 }
        );
      }
      return NextResponse.json({
        ok: true,
        mode: "builtin",
        publicBaseUrl: base,
        warning,
        detail: "Instagram-style download of a real clip succeeded.",
      });
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          mode: "builtin",
          error: `Could not download the signed link: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        },
        { status: 400 }
      );
    }
  }

  if (!settings.storageConfigured) {
    return NextResponse.json(
      {
        ok: false,
        error: "Fill in the endpoint, bucket, access key id and secret first.",
      },
      { status: 400 }
    );
  }

  const config: S3Config = {
    endpoint: settings.storageEndpoint,
    region: settings.storageRegion || "auto",
    bucket: settings.storageBucket,
    accessKeyId: settings.storageAccessKeyId,
    secretAccessKey: settings.rawStorageSecret,
    pathPrefix: settings.storagePrefix,
    publicBaseUrl: settings.storagePublicBaseUrl,
    forcePathStyle: settings.storageForcePathStyle,
  };

  const result = await testStorage(config);
  return NextResponse.json({ ...result, mode: "s3" }, { status: result.ok ? 200 : 400 });
}
