import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, loginAccount, setSessionCookie } from "@/lib/auth";
import { getEffectiveSettings } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export async function POST(req: Request) {
  const limited = enforceRateLimit(req, "auth:login", 8, 5 * 60_000);
  if (limited) return limited;
  try {
    const body = await req.json();
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid credentials." },
        { status: 400 }
      );
    }

    const { user, authProvider } = await loginAccount(parsed.data);
    const token = await createSessionToken(user.id);
    await setSessionCookie(token);

    const { rawTwitchToken, rawYoutubeKey, rawKickToken, ...settings } =
      getEffectiveSettings(user.id);
    void rawTwitchToken;
    void rawYoutubeKey;
    void rawKickToken;

    return NextResponse.json({ user, settings, authProvider });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed." },
      { status: 401 }
    );
  }
}
