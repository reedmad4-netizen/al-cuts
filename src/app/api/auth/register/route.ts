import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  registerAccount,
  setSessionCookie,
} from "@/lib/auth";
import { getEffectiveSettings } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long.")
    .max(128),
  displayName: z
    .string()
    .min(2, "Display name must be at least 2 characters.")
    .max(60),
  handle: z.string().max(32).optional(),
});

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "auth:register", 5, 10 * 60_000);
  if (limited) return limited;
  try {
    const body = await req.json();
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input." },
        { status: 400 }
      );
    }

    const { user, authProvider } = await registerAccount(parsed.data);
    const token = await createSessionToken(user.id);
    await setSessionCookie(token);

    const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...settings } =
      getEffectiveSettings(user.id);
    void rawTwitchToken;
    void rawYoutubeKey;
    void rawKickToken;

    return NextResponse.json({ user, settings, authProvider }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to register account.",
      },
      { status: 400 }
    );
  }
}
