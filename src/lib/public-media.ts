/**
 * Signed, expiring URLs for clips served by this app.
 *
 * Instagram (and any other platform) fetches videos from a public URL, so the
 * simplest possible hosting is the app itself. That is only safe if the URL is
 * unguessable and short-lived — otherwise every clip would be world-readable by
 * scanning ids. So each link carries an HMAC over `{clipId, exp}` keyed with the
 * server secret; the media route verifies it before touching the file.
 */
import crypto from "node:crypto";
import { getServerSecret } from "./auth";

const TOKEN_VERSION = 1;

function hmac(payload: string): string {
  return crypto
    .createHmac("sha256", getServerSecret())
    .update(payload)
    .digest("base64url");
}

function encode(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export interface MediaGrant {
  clipId: string;
  expiresAt: number;
  /** Limits a leaked link to one file, not the whole library. */
  kind: "clip";
}

export function signMediaToken(
  clipId: string,
  ttlSeconds: number,
  now: number = Date.now()
): string {
  const grant: MediaGrant = {
    clipId,
    expiresAt: Math.floor(now / 1000) + Math.max(60, ttlSeconds),
    kind: "clip",
  };
  const payload = encode({ v: TOKEN_VERSION, ...grant });
  return `${payload}.${hmac(payload)}`;
}

export type TokenCheck =
  | { ok: true; grant: MediaGrant }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyMediaToken(token: string, now: number = Date.now()): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [payload, signature] = parts;

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature" };
  }

  let parsed: { v?: number; clipId?: unknown; expiresAt?: unknown; kind?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    parsed.v !== TOKEN_VERSION ||
    typeof parsed.clipId !== "string" ||
    typeof parsed.expiresAt !== "number" ||
    parsed.kind !== "clip"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (parsed.expiresAt * 1000 <= now) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    grant: { clipId: parsed.clipId, expiresAt: parsed.expiresAt, kind: "clip" },
  };
}

/** Trims trailing slashes so URL joins stay predictable. */
export function normalizeBaseUrl(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

export function buildPublicMediaUrl(
  baseUrl: string,
  clipId: string,
  ttlSeconds: number
): { url: string; expiresAt: string } {
  const token = signMediaToken(clipId, ttlSeconds);
  const expiresAt = new Date(
    (Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds)) * 1000
  ).toISOString();
  return {
    url: `${normalizeBaseUrl(baseUrl)}/api/public/short/${token}`,
    expiresAt,
  };
}

/**
 * Instagram downloads from the public internet over HTTPS (plain HTTP works in
 * development against localhost only). Returns a human warning when the base URL
 * cannot possibly work for Meta.
 */
export function hostingWarning(baseUrl: string): string | null {
  if (!baseUrl) return "No public URL is configured for media hosting.";
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return `"${baseUrl}" is not a valid URL — it needs to start with https://.`;
  }
  if (parsed.protocol === "https:") return null;
  const local =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname.endsWith(".local");
  if (local) {
    return "This URL only works on your machine. Instagram cannot reach localhost — deploy the app (or use a tunnel) and set its public HTTPS URL.";
  }
  return "Instagram requires an HTTPS URL; this server is configured with http://.";
}
