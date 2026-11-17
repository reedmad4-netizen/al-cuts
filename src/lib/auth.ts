import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, mapUserRow, type ClipRowWithPaths } from "./db";
import { getSupabaseClient } from "./supabase";
import type { StreamRecord, UserProfile } from "./types";

export const SESSION_COOKIE = "clipx_session";

const AVATAR_PALETTE = [
  "#2563EB",
  "#1D4ED8",
  "#0284C7",
  "#0F172A",
  "#4F46E5",
  "#0D9488",
];

const MIN_SECRET_LENGTH = 32;
const LOCAL_SECRET_PATH = path.join(process.cwd(), "data", "auth-secret");
let cachedSecret: Uint8Array | null = null;

/**
 * Loads the HS256 signing key.
 *
 * There is deliberately NO hardcoded fallback: a committed default secret lets
 * anyone forge a session token for any user id. If no secret is configured we
 * generate a strong random one on first boot and persist it under `data/`
 * (git-ignored, mode 0600) so the zero-config demo keeps working while every
 * deployment still gets a unique, unguessable key.
 */
function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;

  const fromEnv = (
    process.env.CLIPX_AUTH_SECRET ||
    process.env.JWT_SECRET ||
    ""
  ).trim();

  if (fromEnv && fromEnv.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `CLIPX_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`
    );
  }

  let secret = fromEnv;

  if (!secret) {
    try {
      const existing = fs.readFileSync(LOCAL_SECRET_PATH, "utf8").trim();
      if (existing.length >= MIN_SECRET_LENGTH) secret = existing;
    } catch {
      // No persisted secret yet — create one below.
    }

    if (!secret) {
      secret = crypto.randomBytes(48).toString("base64url");
      fs.mkdirSync(path.dirname(LOCAL_SECRET_PATH), { recursive: true });
      fs.writeFileSync(LOCAL_SECRET_PATH, secret, { mode: 0o600 });
      console.warn(
        "[CLIPX AI] CLIPX_AUTH_SECRET is not set. Generated a unique local signing key at data/auth-secret. " +
          "Set CLIPX_AUTH_SECRET explicitly when deploying more than one instance."
      );
    }
  }

  cachedSecret = new TextEncoder().encode(secret);
  return cachedSecret;
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(getJwtSecret());
}

export async function verifySessionToken(
  token: string
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Cookies are only marked `Secure` when the request actually arrived over
 * HTTPS, so plain-HTTP local development keeps working while every real
 * deployment gets transport-bound session cookies.
 */
async function isSecureRequest(): Promise<boolean> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (proto) return proto.toLowerCase() === "https";
  } catch {
    // `headers()` is unavailable outside a request scope.
  }
  return (process.env.CLIPX_PUBLIC_URL || "").startsWith("https://");
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isSecureRequest(),
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: await isSecureRequest(),
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<UserProfile | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const userId = await verifySessionToken(token);
    if (!userId) return null;
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId) as Record<string, unknown> | undefined;
    return row ? mapUserRow(row) : null;
  } catch {
    return null;
  }
}

export async function registerAccount(params: {
  email: string;
  password: string;
  displayName: string;
  handle?: string;
}): Promise<{ user: UserProfile; authProvider: "supabase" | "local" }> {
  const db = getDb();
  const email = params.email.trim().toLowerCase();
  const displayName = params.displayName.trim();
  const rawHandle = (
    params.handle?.trim() ||
    email.split("@")[0].replace(/[^a-z0-9_]/gi, "")
  ).replace(/^@+/, "");
  const handle = `@${rawHandle || "creator"}`;

  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email);
  if (existing) {
    throw new Error("An account with this email already exists. Please sign in.");
  }

  let userId = `user-${crypto.randomUUID().slice(0, 12)}`;
  let authProvider: "supabase" | "local" = "local";

  // If Supabase Auth is configured, register in Supabase Auth first
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: params.password,
      options: { data: { display_name: displayName, handle } },
    });
    if (!error && data.user?.id) {
      userId = data.user.id;
      authProvider = "supabase";
    }
  }

  const passwordHash = await bcrypt.hash(params.password, 10);
  const avatarColor =
    AVATAR_PALETTE[Math.floor(Math.random() * AVATAR_PALETTE.length)];
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, handle, bio, avatar_color, is_demo_account, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    userId,
    email,
    passwordHash,
    displayName,
    handle,
    "Gaming creator clipping highlights with CLIPX AI.",
    avatarColor,
    now
  );

  db.prepare(
    `INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)`
  ).run(userId, now);

  const row = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(userId) as Record<string, unknown>;
  return { user: mapUserRow(row), authProvider };
}

export async function loginAccount(params: {
  email: string;
  password: string;
}): Promise<{ user: UserProfile; authProvider: "supabase" | "local" }> {
  const db = getDb();
  const email = params.email.trim().toLowerCase();

  // Check Supabase Auth first when configured
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: params.password,
    });
    if (!error && data.user) {
      let row = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(email) as Record<string, unknown> | undefined;
      if (!row) {
        const now = new Date().toISOString();
        const hash = await bcrypt.hash(params.password, 10);
        const name =
          String(data.user.user_metadata?.display_name || email.split("@")[0]);
        db.prepare(
          `INSERT INTO users (id, email, password_hash, display_name, handle, bio, avatar_color, is_demo_account, created_at)
           VALUES (?, ?, ?, ?, ?, '', '#2563EB', 0, ?)`
        ).run(data.user.id, email, hash, name, `@${email.split("@")[0]}`, now);
        db.prepare(
          "INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)"
        ).run(data.user.id, now);
        row = db
          .prepare("SELECT * FROM users WHERE id = ?")
          .get(data.user.id) as Record<string, unknown>;
      }
      return { user: mapUserRow(row), authProvider: "supabase" };
    }
  }

  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as Record<string, unknown> | undefined;
  if (!row) {
    throw new Error("Invalid email or password.");
  }

  const valid = await bcrypt.compare(
    params.password,
    String(row.password_hash)
  );
  if (!valid) {
    throw new Error("Invalid email or password.");
  }

  return { user: mapUserRow(row), authProvider: "local" };
}

/**
 * Verifies whether the current user owns or is authorized to export/edit a clip.
 */
export function canUserExportClip(
  clip: ClipRowWithPaths,
  user: UserProfile | null
): { allowed: boolean; reason: string } {
  if (!clip.ownerAuthorized) {
    return {
      allowed: false,
      reason:
        "Export blocked: stream ownership or clip authorization has not been verified for this source.",
    };
  }
  if (clip.isDemo) {
    return {
      allowed: true,
      reason: "Authorized CLIPX AI demo sample clip.",
    };
  }
  if (clip.userId && (!user || clip.userId !== user.id)) {
    return {
      allowed: false,
      reason:
        "You must be signed in as the clip owner to export or modify this clip.",
    };
  }
  return {
    allowed: true,
    reason: "Verified channel owner / authorized creator export.",
  };
}

/**
 * Stream authorization.
 *
 * Read access follows the visibility rule used by `GET /api/streams`
 * (own streams + shared/demo streams). Any *mutating* action requires an
 * authenticated owner — the previous code had no check at all, which let any
 * visitor stop or delete another user's stream (and its uploaded source file).
 */
export function canReadStream(
  stream: Pick<StreamRecord, "userId" | "isDemo">,
  user: UserProfile | null
): boolean {
  if (stream.isDemo || stream.userId === null) return true;
  return Boolean(user && stream.userId === user.id);
}

export function canModifyStream(
  stream: Pick<StreamRecord, "userId" | "isDemo" | "title">,
  user: UserProfile | null
): { allowed: boolean; reason: string } {
  if (stream.isDemo) {
    return {
      allowed: false,
      reason:
        "The built-in Demo Sandbox stream is read-only. Stop it from the monitoring page instead.",
    };
  }
  if (!user) {
    return {
      allowed: false,
      reason: "Sign in to manage this stream.",
    };
  }
  if (stream.userId === null) {
    return {
      allowed: false,
      reason:
        "This stream has no owner recorded (created by an older version). It is read-only.",
    };
  }
  if (stream.userId !== user.id) {
    return {
      allowed: false,
      reason: "You can only manage streams that you connected.",
    };
  }
  return { allowed: true, reason: "Stream owner." };
}

/** Manual capture is allowed for the owner and for the shared demo sandbox. */
export function canTriggerStream(
  stream: Pick<StreamRecord, "userId" | "isDemo">,
  user: UserProfile | null
): { allowed: boolean; reason: string } {
  if (stream.isDemo) return { allowed: true, reason: "Demo sandbox capture." };
  if (!user) {
    return {
      allowed: false,
      reason: "Sign in to capture clips from this stream.",
    };
  }
  if (stream.userId !== user.id) {
    return {
      allowed: false,
      reason: "You can only capture clips from streams that you connected.",
    };
  }
  return { allowed: true, reason: "Stream owner." };
}
