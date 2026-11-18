"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Crop,
  Download,
  MessageSquare,
  Music,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { ScoreBar } from "@/components/ScoreBar";

const FEATURES = [
  {
    icon: Radio,
    title: "Authorized Stream Monitoring",
    description:
      "Connect Twitch Helix, YouTube Data API v3, Kick Official API, authorized HLS feeds, or your own gameplay recordings with truthful live status checks.",
  },
  {
    icon: Clock,
    title: "20-Second Rolling Ring Buffer",
    description:
      "Continuously holds the preceding 20 seconds in memory. The instant an exciting moment fires, CLIPX AI locks those 20 seconds plus configurable post-event footage.",
  },
  {
    icon: MessageSquare,
    title: "Real-Time Chat Surge Detection",
    description:
      "WebSocket telemetry tracks message velocity against your stream's rolling baseline, catching 'CLIP IT', '1V5', and 'ACE' surges while suppressing duplicate clips.",
  },
  {
    icon: Sparkles,
    title: "0–100 Multi-Signal AI Scoring",
    description:
      "Every generated clip is scored across chat velocity, gameplay intensity, sudden audio reactions, in-game events, and viewer engagement.",
  },
  {
    icon: Crop,
    title: "FFmpeg Studio Video Editor",
    description:
      "Trim exact timestamps, reframe to 9:16 vertical, 16:9 landscape, or 1:1 square, burn crisp headline captions and timed subtitles, and render H.264 MP4s.",
  },
  {
    icon: Music,
    title: "Non-Destructive Music Detection",
    description:
      "Acoustic analysis flags clips with potentially copyrighted music and warns before export — never muting, stripping, or replacing audio without permission.",
  },
];

const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Authorize & Monitor",
    body: "Link an authorized stream or test inside the clearly badged Demo Sandbox. The 20-second rolling buffer starts immediately.",
  },
  {
    step: "02",
    title: "Auto-Detect & Score",
    body: "Chat spikes and audio/video peaks trigger automatic MP4 capture (20s pre + post-event), duplicate filtering, AI scoring, and music checks.",
  },
  {
    step: "03",
    title: "Reframe & Export MP4",
    body: "Crop to 9:16 Shorts/TikTok/Reels, add captions and subtitles with FFmpeg, verify copyright notices, and download ready-to-post MP4s.",
  },
];

export default function LandingPage() {
  const { user } = useApp();
  const [heroPlaying, setHeroPlaying] = useState(false);

  return (
    <div className="min-h-screen bg-white text-zinc-950">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-zinc-100">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="focus:outline-none">
            <Logo size="md" />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-600">
            <a href="#features" className="hover:text-zinc-950 transition">
              Features
            </a>
            <a href="#workflow" className="hover:text-zinc-950 transition">
              How It Works
            </a>
            <Link href="/monitoring" className="hover:text-zinc-950 transition">
              Live Monitor
            </Link>
            <Link href="/clips" className="hover:text-zinc-950 transition">
              Clips
            </Link>
            <Link href="/editor" className="hover:text-zinc-950 transition">
              Editor
            </Link>
          </nav>

          <div className="flex items-center gap-2.5">
            {user ? (
              <Link
                href="/settings"
                className="hidden sm:inline-flex items-center rounded-xl border border-zinc-200 px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition"
              >
                {user.displayName}
              </Link>
            ) : (
              <Link
                href="/auth"
                className="inline-flex items-center rounded-xl px-3.5 py-2 text-sm font-semibold text-zinc-700 hover:text-zinc-950 transition"
              >
                Sign In
              </Link>
            )}
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition shadow-subtle"
            >
              Open Studio
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-blue-50/55 to-transparent"
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50/80 px-3.5 py-1 text-xs font-semibold text-blue-700 mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              20s Rolling Buffer · Multi-Signal AI Scoring · Real FFmpeg Editor
            </div>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-zinc-950 leading-[1.06]">
              Turn live gaming moments into{" "}
              <span className="text-blue-600">viral clips</span> automatically.
            </h1>

            <p className="mt-5 text-base sm:text-lg text-zinc-600 leading-relaxed max-w-2xl mx-auto">
              CLIPX AI watches your authorized streams in real time, catches chat
              surges and clutch plays with a 20-second rolling buffer, scores every
              highlight 0–100, and exports edited 9:16, 16:9, or 1:1 MP4s.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition shadow-card"
              >
                Launch Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/monitoring"
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-6 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300 transition shadow-subtle"
              >
                <Radio className="h-4 w-4 text-blue-600" />
                Connect Stream or Try Demo
              </Link>
            </div>
          </div>

          {/* Interactive Live Product Showcase Card */}
          <div className="mt-14 mx-auto max-w-5xl rounded-3xl border border-zinc-200 bg-white p-3 sm:p-5 shadow-elevated">
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-3 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-200" />
                <span className="ml-2 text-xs font-semibold text-zinc-700">
                  CLIPX AI Studio Preview
                </span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                DEMO SAMPLE CLIP · INTERACTIVE PREVIEW
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
              {/* Video Frame */}
              <div className="lg:col-span-8 rounded-2xl overflow-hidden bg-zinc-950 relative aspect-video">
                {heroPlaying ? (
                  <video
                    src="/api/media/clips/demo-fps-clutch.mp4"
                    poster="/api/media/posters/fps-clutch.jpg"
                    controls
                    autoPlay
                    playsInline
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setHeroPlaying(true)}
                    className="group relative block h-full w-full text-left"
                    aria-label="Play sample AI-generated gaming clip"
                  >
                    <img
                      src="/api/media/posters/fps-clutch.jpg"
                      alt="1v5 Neon Site Retake Ace sample clip"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-black/20" />
                    <span className="absolute inset-0 flex items-center justify-center">
                      <span className="inline-flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-xs font-bold text-zinc-950 shadow-xl transition-transform duration-200 group-hover:scale-105">
                        <Play className="h-4 w-4 fill-blue-600 text-blue-600" />
                        Play 28s Sample Clip
                      </span>
                    </span>
                    <div className="absolute bottom-3 left-3 right-3">
                      <div className="flex items-center justify-between text-[11px] font-mono text-white/90 mb-1.5">
                        <span>-20.0s Rolling Buffer</span>
                        <span className="rounded bg-blue-600 px-1.5 py-0.5 font-bold">
                          EVENT @ 0:20
                        </span>
                        <span>+8.0s Post-Event</span>
                      </div>
                      <div className="grid grid-cols-14 gap-1 h-1.5">
                        {Array.from({ length: 14 }).map((_, idx) => (
                          <div
                            key={idx}
                            className={`rounded-full ${
                              idx >= 10
                                ? "bg-blue-500"
                                : idx >= 8
                                ? "bg-blue-300"
                                : "bg-white/55"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </button>
                )}
              </div>

              {/* Live AI Breakdown Column */}
              <div className="lg:col-span-4 flex flex-col justify-between rounded-2xl border border-zinc-200/90 bg-zinc-50/60 p-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-600">
                    Auto-Detected Highlight
                  </p>
                  <h2 className="mt-1 text-base font-extrabold text-zinc-950 leading-snug">
                    1v5 Neon Site Retake Ace in Overtime
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Neon Protocol · 28s MP4 (20s pre + 8s post)
                  </p>

                  <div className="mt-4 rounded-xl bg-white border border-zinc-200 p-3.5">
                    <ScoreBar score={95} />
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
                        <span className="text-zinc-500 block">Chat Surge</span>
                        <span className="font-mono font-bold text-zinc-950">
                          4.8x (97/100)
                        </span>
                      </div>
                      <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
                        <span className="text-zinc-500 block">In-Game Event</span>
                        <span className="font-mono font-bold text-zinc-950">
                          ACE (98/100)
                        </span>
                      </div>
                      <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
                        <span className="text-zinc-500 block">Reactions</span>
                        <span className="font-mono font-bold text-zinc-950">
                          +21 dB (93/100)
                        </span>
                      </div>
                      <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5">
                        <span className="text-zinc-500 block">Music Check</span>
                        <span className="font-semibold text-emerald-700">
                          Clean Audio
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <Link
                    href="/editor?clip=clip-demo-1"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 transition"
                  >
                    <Crop className="h-3.5 w-3.5" />
                    Edit in 9:16
                  </Link>
                  <Link
                    href="/downloads"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 transition"
                  >
                    <Download className="h-3.5 w-3.5" />
                    MP4
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Capabilities */}
      <section
        id="features"
        className="py-20 border-t border-zinc-100 bg-[#FAFAFA]"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
              Complete Clip Pipeline
            </p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-950">
              Built for creators who never want to miss a play.
            </h2>
            <p className="mt-3 text-sm sm:text-base text-zinc-600">
              From real-time WebSocket chat monitoring to FFmpeg vertical reframing
              and copyright-safe export checks — everything runs in one minimal
              workspace.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-subtle hover:shadow-card transition"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-base font-bold text-zinc-950">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                    {f.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="workflow" className="py-20 border-t border-zinc-100 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {WORKFLOW_STEPS.map((w) => (
              <div
                key={w.step}
                className="rounded-2xl border border-zinc-200 p-6 bg-white"
              >
                <span className="font-mono text-xs font-bold text-blue-600">
                  STEP {w.step}
                </span>
                <h3 className="mt-2 text-lg font-extrabold text-zinc-950">
                  {w.title}
                </h3>
                <p className="mt-2 text-sm text-zinc-600 leading-relaxed">
                  {w.body}
                </p>
              </div>
            ))}
          </div>

          {/* Creator Rights & API Compliance Banner */}
          <div className="mt-12 rounded-2xl border border-zinc-200 bg-zinc-50 p-6 sm:p-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 text-xs font-bold text-zinc-900">
                <ShieldCheck className="h-4 w-4 text-blue-600" />
                Creator Authorization & Audio Integrity Guarantee
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-zinc-600">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Official platform APIs & owner-authorized sources only
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Audio never removed or replaced without user permission
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Demo data transparently separated from live streams
                </span>
              </div>
            </div>

            <Link
              href="/auth"
              className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 transition"
            >
              Create Account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-100 py-10 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-zinc-500">
            <Link href="/dashboard" className="hover:text-zinc-950">
              Dashboard
            </Link>
            <Link href="/monitoring" className="hover:text-zinc-950">
              Live Monitoring
            </Link>
            <Link href="/chat" className="hover:text-zinc-950">
              Chat Activity
            </Link>
            <Link href="/clips" className="hover:text-zinc-950">
              Generated Clips
            </Link>
            <Link href="/editor" className="hover:text-zinc-950">
              Video Editor
            </Link>
            <Link href="/downloads" className="hover:text-zinc-950">
              Downloads
            </Link>
            <Link href="/settings" className="hover:text-zinc-950">
              Settings
            </Link>
            <Link href="/auth" className="hover:text-zinc-950">
              Login / Register
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
