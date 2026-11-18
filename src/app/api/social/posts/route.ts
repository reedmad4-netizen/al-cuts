import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listSocialPosts } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to view publishing history." }, { status: 401 });
  }
  return NextResponse.json({ posts: listSocialPosts(user.id, 50) });
}
