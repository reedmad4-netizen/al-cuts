"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";

export default function AuthPage() {
  const router = useRouter();
  const { user, refreshAuth, signInDemo, logout, notify } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint =
        mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload =
        mode === "register"
          ? { email, password, displayName, handle }
          : { email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Authentication failed.");
        return;
      }

      await refreshAuth();
      notify({
        type: "success",
        title:
          mode === "register"
            ? `Welcome to CLIPX AI, ${data.user.displayName}!`
            : `Welcome back, ${data.user.displayName}!`,
        description: "Your saved clips, history, and settings are synced.",
      });
      router.push("/dashboard");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unexpected authentication error."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDemoLogin() {
    setSubmitting(true);
    const ok = await signInDemo();
    setSubmitting(false);
    if (ok) router.push("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      {/* Minimal Header */}
      <header className="h-16 px-4 sm:px-8 flex items-center justify-between bg-white border-b border-zinc-100">
        <Link href="/">
          <Logo size="md" />
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-600 hover:text-zinc-950 transition"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Studio
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-7 sm:p-8 shadow-elevated animate-fade-in">
          {user ? (
            <div className="space-y-5 text-center">
              <div
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-extrabold text-white shadow-subtle"
                style={{ backgroundColor: user.avatarColor }}
              >
                {user.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mb-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Signed In
                </div>
                <h1 className="text-xl font-extrabold text-zinc-950">
                  {user.displayName}
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {user.handle} · {user.email}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-2">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 transition"
                >
                  Open Dashboard
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href="/settings"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                >
                  Profile & History
                </Link>
              </div>

              <button
                type="button"
                onClick={() => void logout()}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 transition"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out / Switch Account
              </button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-2xl font-extrabold tracking-tight text-zinc-950">
                  {mode === "login"
                    ? "Sign in to CLIPX AI"
                    : "Create your creator account"}
                </h1>
                <p className="mt-1.5 text-xs text-zinc-500">
                  Save generated clips, keep export history, and manage official
                  streaming API connections.
                </p>
              </div>

              {/* Mode Switch */}
              <div className="mt-6 grid grid-cols-2 rounded-xl bg-zinc-100 p-1 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                  className={`rounded-lg py-2 transition ${
                    mode === "login"
                      ? "bg-white text-zinc-950 shadow-subtle"
                      : "text-zinc-600"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                  className={`rounded-lg py-2 transition ${
                    mode === "register"
                      ? "bg-white text-zinc-950 shadow-subtle"
                      : "text-zinc-600"
                  }`}
                >
                  Register
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-5 space-y-3.5">
                {mode === "register" && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Display Name
                      </label>
                      <input
                        type="text"
                        required
                        minLength={2}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Alex Rivera"
                        className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 mb-1">
                        Creator Handle (Optional)
                      </label>
                      <input
                        type="text"
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        placeholder="@alexplays"
                        className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={mode === "register" ? 8 : 1}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      mode === "register"
                        ? "Minimum 8 characters"
                        : "Enter your password"
                    }
                    className="w-full rounded-xl border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "login" ? (
                    "Sign In"
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-zinc-200" />
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="bg-white px-2.5 text-zinc-400 font-medium">
                    or explore instantly
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleDemoLogin()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 transition"
              >
                <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                Continue with Demo Creator Account
              </button>

              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                Supabase Auth compatible · Bcrypt + HTTP-only JWT session
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
