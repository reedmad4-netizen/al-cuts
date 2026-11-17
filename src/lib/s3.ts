import crypto from "node:crypto";
import { describeNetworkError } from "./net-errors";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal S3-compatible client (AWS S3, Cloudflare R2, Backblaze B2, MinIO).
 *
 * Implemented directly against SigV4 rather than pulling in the AWS SDK: the
 * app only needs "PUT an object" and "hand out a temporary public GET URL",
 * and Instagram must be able to download the object anonymously.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathPrefix: string;
  /** Optional CDN / public bucket base URL. When empty, presigned GET URLs are used. */
  publicBaseUrl: string;
  forcePathStyle: boolean;
}

export interface S3Error extends Error {
  s3Status?: number;
}

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodeS3Path(key: string): string {
  return key
    .split("/")
    .map((segment) => rfc3986(segment))
    .join("/");
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDateParts(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export interface S3Location {
  /** Full URL used for the signed request. */
  requestUrl: URL;
  /** Host header value (bucket may be part of the hostname). */
  host: string;
  /** Object path component of the URL. */
  canonicalPath: string;
}

export function objectLocation(config: S3Config, key: string): S3Location {
  const endpoint = new URL(
    /^https?:\/\//i.test(config.endpoint)
      ? config.endpoint
      : `https://${config.endpoint}`
  );
  const objectPath = `${config.pathPrefix ? `${config.pathPrefix.replace(/^\/+|\/+$/g, "")}/` : ""}${key}`;
  // Endpoints may include a base path (e.g. MinIO behind https://host/minio) —
  // keep it, otherwise path-style requests would lose the mount point.
  const basePath = endpoint.pathname.replace(/\/+$/, "");

  if (config.forcePathStyle) {
    const requestUrl = new URL(endpoint.toString());
    requestUrl.pathname = `${basePath}/${config.bucket}/${encodeS3Path(objectPath)}`;
    return {
      requestUrl,
      host: requestUrl.host,
      canonicalPath: requestUrl.pathname,
    };
  }

  const requestUrl = new URL(endpoint.toString());
  requestUrl.hostname = `${config.bucket}.${endpoint.hostname}`;
  requestUrl.pathname = `${basePath}/${encodeS3Path(objectPath)}`;
  return { requestUrl, host: requestUrl.host, canonicalPath: requestUrl.pathname };
}

function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service = "s3"
): Buffer {
  return hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    "aws4_request"
  );
}

export interface SignedRequestHeaders {
  host: string;
  authorization: string;
  "x-amz-content-sha256": string;
  "x-amz-date": string;
}

/** Header-based SigV4 signing — used for uploads. */
export function signRequest(params: {
  config: S3Config;
  method: string;
  location: S3Location;
  payloadHash: string;
  contentType?: string;
  now?: Date;
}): SignedRequestHeaders {
  const { config, method, location } = params;
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = amzDateParts(now);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const headerMap: Record<string, string> = {
    host: location.host,
    "x-amz-content-sha256": params.payloadHash,
    "x-amz-date": amzDate,
  };
  if (params.contentType) headerMap["content-type"] = params.contentType;

  const sortedNames = Object.keys(headerMap).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${headerMap[name].trim()}\n`)
    .join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [
    method,
    location.canonicalPath,
    "", // no query string for header-signed requests
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    host: location.host,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "x-amz-content-sha256": params.payloadHash,
    "x-amz-date": amzDate,
  };
}

/**
 * Query-based SigV4 (presigned URL) — used to hand Instagram a temporary
 * public download link that requires no credentials.
 */
export function presignGetUrl(params: {
  config: S3Config;
  key: string;
  expiresSeconds?: number;
  now?: Date;
}): string {
  const { config } = params;
  const expires = Math.min(Math.max(params.expiresSeconds ?? 3600, 60), 604800);
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = amzDateParts(now);
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const location = objectLocation(config, params.key);

  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${rfc3986(key)}=${rfc3986(query[key])}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    location.canonicalPath,
    canonicalQuery,
    `host:${location.host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  const url = location.requestUrl;
  url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url.toString();
}

export interface PutObjectResult {
  key: string;
  url: string;
  bytes: number;
  publicUrl: string;
  expiresAt: string;
}

export async function putObject(params: {
  config: S3Config;
  key: string;
  body: Buffer;
  contentType: string;
  publicUrlTtlSeconds?: number;
}): Promise<PutObjectResult> {
  const { config, key, body, contentType } = params;
  const location = objectLocation(config, key);
  const payloadHash = sha256Hex(body);
  const headers = signRequest({
    config,
    method: "PUT",
    location,
    payloadHash,
    contentType,
  });

  let res: Response;
  try {
    res = await fetch(location.requestUrl, {
    method: "PUT",
    headers: {
      Authorization: headers.authorization,
      "x-amz-content-sha256": headers["x-amz-content-sha256"],
      "x-amz-date": headers["x-amz-date"],
      "Content-Type": contentType,
      "Content-Length": String(body.length),
    },
    // Copy into a plain Uint8Array: Node's Buffer is not a valid BodyInit type.
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(
      describeNetworkError(err, {
        action: "Storage upload",
        url: location.requestUrl.toString(),
      })
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const error = new Error(
      `Storage upload failed (HTTP ${res.status}). ${describeStorageError(res.status, detail, config)}`
    ) as S3Error;
    error.s3Status = res.status;
    throw error;
  }

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/+$/, "")}/${encodeS3Path(
        resolveObjectKey(config, key)
      )}`
    : presignGetUrl({
        config,
        key,
        expiresSeconds: params.publicUrlTtlSeconds ?? 86_400,
      });

  return {
    key: resolveObjectKey(config, key),
    url: location.requestUrl.toString(),
    bytes: body.length,
    publicUrl,
    expiresAt: new Date(
      Date.now() + (params.publicUrlTtlSeconds ?? 86_400) * 1000
    ).toISOString(),
  };
}

/** Object key including the configured prefix. */
export function resolveObjectKey(config: S3Config, key: string): string {
  const prefix = config.pathPrefix.replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${key}` : key;
}

export async function uploadFile(params: {
  config: S3Config;
  filePath: string;
  key: string;
  contentType?: string;
  publicUrlTtlSeconds?: number;
}): Promise<PutObjectResult> {
  const body = await fs.promises.readFile(params.filePath);
  const contentType =
    params.contentType || contentTypeForExtension(path.extname(params.filePath));
  return putObject({
    config: params.config,
    key: params.key,
    body,
    contentType,
    publicUrlTtlSeconds: params.publicUrlTtlSeconds,
  });
}

export function contentTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function describeStorageError(
  status: number,
  detail: string,
  config: S3Config
): string {
  const snippet = detail.replace(/\s+/g, " ").slice(0, 300);
  if (status === 403) {
    return (
      "The bucket rejected the credentials. Check the access key/secret, that the key may write to " +
      `'${config.bucket}', and the region ('${config.region}') — ${snippet}`
    );
  }
  if (status === 404) {
    return `Bucket '${config.bucket}' was not found at ${config.endpoint} — ${snippet}`;
  }
  if (status === 301 || status === 400) {
    return `Endpoint/region mismatch for ${config.endpoint} (region '${config.region}') — ${snippet}`;
  }
  return snippet || "No response body.";
}

/**
 * Round-trips a tiny object through the bucket so misconfiguration is caught
 * in Settings rather than mid-publish.
 */
export async function testStorage(config: S3Config): Promise<{
  ok: boolean;
  publicUrl?: string;
  bytes?: number;
  error?: string;
}> {
  const key = `_healthcheck/${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")}.txt`;
  const payload = Buffer.from(`CLIPX AI storage check ${new Date().toISOString()}`);
  try {
    const uploaded = await putObject({
      config,
      key,
      body: payload,
      contentType: "text/plain",
      publicUrlTtlSeconds: 300,
    });

    // Verify the link Instagram would use is actually readable.
    let res: Response;
    try {
      res = await fetch(uploaded.publicUrl, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      return {
        ok: false,
        publicUrl: uploaded.publicUrl,
        error: describeNetworkError(err, {
          action: "Public link check",
          url: uploaded.publicUrl,
        }),
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        publicUrl: uploaded.publicUrl,
        error:
          `Uploaded to the bucket, but the public URL returned HTTP ${res.status}. ` +
          "If the bucket is private, leave 'Public base URL' empty so presigned links are used.",
      };
    }
    return { ok: true, publicUrl: uploaded.publicUrl, bytes: payload.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
