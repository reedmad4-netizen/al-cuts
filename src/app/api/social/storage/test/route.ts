import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSocialSettings } from "@/lib/db";
import { testStorage, type S3Config } from "@/lib/s3";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Uploads a tiny object and downloads it back to prove the bucket works. */
export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "social:storage-test", 10, 5 * 60_000);
  if (limited) return limited;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to test storage." }, { status: 401 });
  }

  const settings = getSocialSettings(user.id);
  if (!settings.storageConfigured) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Fill in the endpoint, bucket, access key id and secret first.",
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
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
