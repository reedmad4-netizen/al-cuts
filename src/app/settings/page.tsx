"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Database,
  History,
  KeyRound,
  Loader2,
  LogIn,
  Music,
  RotateCcw,
  Save,
  Sliders,
  User,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { SourceBadge } from "@/components/Badges";
import { StudioShell } from "@/components/StudioShell";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import type {
  AspectRatio,
  ClipRecord,
  ShortsLayout,
  UserProfile,
  UserSettings,
  VideoQuality,
} from "@/lib/types";

export default function SettingsPage() {
  const { notify, refreshAuth, signInDemo } = useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");

  // Detection, Hype Auto-Shorts & Auto-Download prefs
  const [postBufferSeconds, setPostBufferSeconds] = useState(8);
  const [minAiScore, setMinAiScore] = useState(65);
  const [hypeThreshold, setHypeThreshold] = useState(70);
  const [videoQuality, setVideoQuality] =
    useState<VideoQuality>("1080p_source");
  const [shortsLayout, setShortsLayout] = useState<ShortsLayout>("fit_blur");
  const [autoShortsEnabled, setAutoShortsEnabled] = useState(true);
  const [autoShortsCaption, setAutoShortsCaption] = useState(true);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);
  const [dedupeCooldownSeconds, setDedupeCooldownSeconds] = useState(25);
  const [chatSpikeMultiplier, setChatSpikeMultiplier] = useState(2.6);
  const [defaultAspectRatio, setDefaultAspectRatio] =
    useState<AspectRatio>("16:9");
  const [musicDetectionEnabled, setMusicDetectionEnabled] = useState(true);
  const [warnBeforeCopyrightExport, setWarnBeforeCopyrightExport] =
    useState(true);
  const [showDemoData, setShowDemoData] = useState(true);

  // Official API keys
  const [twitchClientId, setTwitchClientId] = useState("");
  const [twitchAccessToken, setTwitchAccessToken] = useState("");
  const [youtubeApiKey, setYoutubeApiKey] = useState("");
  const [kickApiToken, setKickApiToken] = useState("");
  const [supabaseConfigured, setSupabaseConfigured] = useState(false);
  const [apiFlags, setApiFlags] = useState({
    twitch: false,
    youtube: false,
    kick: false,
  });

  // Clip History
  const [clipHistory, setClipHistory] = useState<ClipRecord[]>([]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const u: UserProfile | null = data.user || null;
      const s: UserSettings = data.settings;

      setProfile(u);
      setDisplayName(u?.displayName || "");
      setHandle(u?.handle || "");
      setBio(u?.bio || "");

      setPostBufferSeconds(s.postBufferSeconds);
      setMinAiScore(s.minAiScore);
      setHypeThreshold(s.hypeThreshold ?? 70);
      setVideoQuality(s.videoQuality ?? "1080p_source");
      setShortsLayout(s.shortsLayout ?? "fit_blur");
      setAutoShortsEnabled(s.autoShortsEnabled ?? true);
      setAutoShortsCaption(s.autoShortsCaption ?? true);
      setAutoDownloadEnabled(s.autoDownloadEnabled ?? true);
      setDedupeCooldownSeconds(s.dedupeCooldownSeconds);
      setChatSpikeMultiplier(s.chatSpikeMultiplier);
      setDefaultAspectRatio(s.defaultAspectRatio);
      setMusicDetectionEnabled(s.musicDetectionEnabled);
      setWarnBeforeCopyrightExport(s.warnBeforeCopyrightExport);
      setShowDemoData(s.showDemoData);

      setTwitchClientId(s.twitchClientId || "");
      setTwitchAccessToken(s.twitchConfigured ? "••••••••" : "");
      setYoutubeApiKey(s.youtubeConfigured ? "••••••••" : "");
      setKickApiToken(s.kickConfigured ? "••••••••" : "");
      setApiFlags({
        twitch: s.twitchConfigured,
        youtube: s.youtubeConfigured,
        kick: s.kickConfigured,
      });
      setSupabaseConfigured(Boolean(data.supabaseConfigured));
      setClipHistory(data.clipHistory || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          ...(profile
            ? { displayName, handle, bio }
            : {}),
          postBufferSeconds,
          minAiScore,
          hypeThreshold,
          videoQuality,
          shortsLayout,
          autoShortsEnabled,
          autoShortsCaption,
          autoDownloadEnabled,
          dedupeCooldownSeconds,
          chatSpikeMultiplier,
          defaultAspectRatio,
          musicDetectionEnabled,
          warnBeforeCopyrightExport,
          showDemoData,
          twitchClientId,
          twitchAccessToken,
          youtubeApiKey,
          kickApiToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save.");
      await refreshAuth();
      await loadSettings();
      notify({
        type: "success",
        title: "Settings Saved",
        description:
          "Profile, 20s buffer rules, copyright checks, and API keys updated.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Save error",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDemo() {
    setResetting(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_demo" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed.");
      await loadSettings();
      notify({
        type: "info",
        title: "Demo Sandbox Reset",
        description: data.message,
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Reset failed",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setResetting(false);
    }
  }

  return (
    <StudioShell
      title="Settings"
      subtitle="Manage your creator profile, 20-second buffer capture rules, copyright policy, official API credentials, and clip history"
    >
      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading account & settings...
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="space-y-6 max-w-4xl animate-fade-in"
        >
          {/* 1. User Profile Card */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-extrabold text-zinc-950">
                User Profile & Account
              </h2>
            </div>

            {profile ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3 pb-3 border-b border-zinc-100">
                  <span
                    className="h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                    style={{ backgroundColor: profile.avatarColor }}
                  >
                    {profile.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-zinc-950">
                      {profile.displayName}{" "}
                      {profile.isDemoAccount && (
                        <span className="ml-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          DEMO ACCOUNT
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{profile.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-950 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 mb-1">
                      Creator Handle
                    </label>
                    <input
                      type="text"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-950 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Bio
                  </label>
                  <input
                    type="text"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-950 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-zinc-50 border border-zinc-200 p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-zinc-950">
                    Not currently signed in
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Create an account or sign in to save personal profile details,
                    private streams, and clip history.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await signInDemo();
                      if (ok) await loadSettings();
                    }}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 transition"
                  >
                    Demo Sign-In
                  </button>
                  <Link
                    href="/auth"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    Sign In / Register
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* 2. Automatic Clip Detection & 20s Buffer Rules */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card space-y-4">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-extrabold text-zinc-950">
                Rolling 20s Buffer & AI Detection Defaults
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-zinc-700">
                    Full Clip & Short Length
                  </span>
                  <span className="font-mono font-bold text-zinc-950">
                    {20 + postBufferSeconds}s (20s pre + {postBufferSeconds}s post)
                  </span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={40}
                  value={postBufferSeconds}
                  onChange={(e) => setPostBufferSeconds(Number(e.target.value))}
                  className="clipx-slider w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-zinc-700">
                    Minimum AI Score Threshold
                  </span>
                  <span className="font-mono font-bold text-zinc-950">
                    {minAiScore}/100
                  </span>
                </div>
                <input
                  type="range"
                  min={30}
                  max={95}
                  value={minAiScore}
                  onChange={(e) => setMinAiScore(Number(e.target.value))}
                  className="clipx-slider w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-zinc-700">
                    Duplicate Prevention Cooldown
                  </span>
                  <span className="font-mono font-bold text-zinc-950">
                    {dedupeCooldownSeconds}s
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={dedupeCooldownSeconds}
                  onChange={(e) =>
                    setDedupeCooldownSeconds(Number(e.target.value))
                  }
                  className="clipx-slider w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-semibold text-zinc-700">
                    Chat Surge Trigger Multiplier
                  </span>
                  <span className="font-mono font-bold text-zinc-950">
                    {chatSpikeMultiplier.toFixed(1)}x baseline
                  </span>
                </div>
                <input
                  type="range"
                  min={1.8}
                  max={5.5}
                  step={0.2}
                  value={chatSpikeMultiplier}
                  onChange={(e) =>
                    setChatSpikeMultiplier(Number(e.target.value))
                  }
                  className="clipx-slider w-full"
                />
              </div>
            </div>

            {/* Hands-Free Hype Threshold -> Original 16:9 + Auto 9:16 Short + Auto-Download */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-extrabold text-zinc-950">
                    Hype Threshold Auto-Shorts & Dual Auto-Download
                  </p>
                  <p className="text-[11px] text-zinc-600">
                    When live stream hype reaches this level, CLIPX AI saves
                    BOTH the untouched 16:9 Original MP4 and a vertical 9:16
                    Short MP4, then auto-downloads both (pausing with a warning
                    if copyrighted music is detected).
                  </p>
                </div>
                <span className="font-mono text-xs font-bold text-blue-700 bg-white border border-blue-200 rounded-lg px-2.5 py-1">
                  Hype ≥ {hypeThreshold}/100
                </span>
              </div>

              <input
                type="range"
                min={30}
                max={95}
                value={hypeThreshold}
                onChange={(e) => setHypeThreshold(Number(e.target.value))}
                className="clipx-slider w-full"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Default Video & Shorts Quality
                  </label>
                  <select
                    value={videoQuality}
                    onChange={(e) =>
                      setVideoQuality(e.target.value as VideoQuality)
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
                  >
                    <option value="1080p_source">
                      1080p60 Source — Lossless 1920×1080 + 1080×1920 Full HD Short
                    </option>
                    <option value="1080p_high">
                      1080p60 High — Full HD 6.5 Mbps (H.264 High + 192k AAC)
                    </option>
                    <option value="720p_balanced">
                      720p60 Balanced — Sharp HD 4.2 Mbps (Smaller Files)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 mb-1">
                    Default 9:16 Shorts Framing
                  </label>
                  <select
                    value={shortsLayout}
                    onChange={(e) =>
                      setShortsLayout(e.target.value as ShortsLayout)
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
                  >
                    <option value="fit_blur">
                      Full Frame HD + Blurred Canvas (100% Visible — Nothing Cut Off)
                    </option>
                    <option value="split_cam">
                      Streamer Facecam Top + Gameplay Bottom (1080×1920)
                    </option>
                    <option value="zoom_crop">
                      Full-Height 9:16 Center Zoom (1080×1920 Lanczos)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-xs">
                <label className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoShortsEnabled}
                    onChange={(e) => setAutoShortsEnabled(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-blue-600"
                  />
                  <span>
                    <strong className="block text-zinc-950">
                      Auto 9:16 Short + Original
                    </strong>
                    <span className="text-[11px] text-zinc-500">
                      Creates vertical Short & keeps original 16:9 MP4
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoShortsCaption}
                    onChange={(e) => setAutoShortsCaption(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-blue-600"
                  />
                  <span>
                    <strong className="block text-zinc-950">
                      Auto-Burn Short Captions
                    </strong>
                    <span className="text-[11px] text-zinc-500">
                      Adds headline & timed subtitles on the 9:16 copy only
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2 rounded-xl border border-zinc-200 bg-white p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoDownloadEnabled}
                    onChange={(e) => setAutoDownloadEnabled(e.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 text-blue-600"
                  />
                  <span>
                    <strong className="block text-zinc-950">
                      Auto-Download Both Files
                    </strong>
                    <span className="text-[11px] text-zinc-500">
                      Saves to clipx-ai/exports/ & browser; warns on music
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Default Editor Aspect Ratio
                </label>
                <select
                  value={defaultAspectRatio}
                  onChange={(e) =>
                    setDefaultAspectRatio(e.target.value as AspectRatio)
                  }
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900"
                >
                  <option value="16:9">16:9 Landscape (1280×720)</option>
                  <option value="9:16">9:16 Vertical Shorts (720×1280)</option>
                  <option value="1:1">1:1 Square Feed (720×720)</option>
                </select>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-zinc-200 px-3.5 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-zinc-900">
                    Show Demo Sample Data
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Clearly badged DEMO items across Studio
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={showDemoData}
                  onChange={(e) => setShowDemoData(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-600"
                />
              </div>
            </div>
          </section>

          {/* 3. Music Detection & Copyright Safety */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card space-y-3">
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-extrabold text-zinc-950">
                Music Detection & Copyright Warnings
              </h2>
            </div>

            <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-zinc-900">
                  Automatic Acoustic Music Detection
                </p>
                <p className="text-[11px] text-zinc-500">
                  Analyze generated clips via FFmpeg spectral DSP & Chromaprint to
                  flag copyrighted tracks
                </p>
              </div>
              <input
                type="checkbox"
                checked={musicDetectionEnabled}
                onChange={(e) => setMusicDetectionEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600"
              />
            </label>

            <label className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3 cursor-pointer">
              <div>
                <p className="text-xs font-semibold text-zinc-900">
                  Require Warning Confirmation Before Export
                </p>
                <p className="text-[11px] text-zinc-500">
                  Show a copyright notice before exporting flagged clips. Audio is
                  never altered without explicit user permission.
                </p>
              </div>
              <input
                type="checkbox"
                checked={warnBeforeCopyrightExport}
                onChange={(e) =>
                  setWarnBeforeCopyrightExport(e.target.checked)
                }
                className="h-4 w-4 rounded border-zinc-300 text-blue-600"
              />
            </label>
          </section>

          {/* 4. Optional Platform API Overrides & Database */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-extrabold text-zinc-950">
                  Optional Platform API Overrides & Database
                </h2>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                <Database className="h-3 w-3 text-emerald-600" />
                {supabaseConfigured
                  ? "Supabase Auth + SQL Connected"
                  : "Keyless Live Mode + Local SQLite Active"}
              </span>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              <strong>No API keys are needed!</strong> Public Twitch, YouTube
              Live, Kick, and direct HLS (<code>.m3u8</code>) streams connect,
              buffer 20s of live footage, and read live chat automatically
              without any credentials. The fields below are completely optional.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Twitch Helix Client ID{" "}
                  {apiFlags.twitch && (
                    <CheckCircle2 className="inline h-3 w-3 text-emerald-600" />
                  )}
                </label>
                <input
                  type="text"
                  value={twitchClientId}
                  onChange={(e) => setTwitchClientId(e.target.value)}
                  placeholder="Official Twitch Developer Client ID"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Twitch OAuth Bearer Token
                </label>
                <input
                  type="password"
                  value={twitchAccessToken}
                  onChange={(e) => setTwitchAccessToken(e.target.value)}
                  placeholder="Official Helix OAuth access token"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  YouTube Data API v3 Key{" "}
                  {apiFlags.youtube && (
                    <CheckCircle2 className="inline h-3 w-3 text-emerald-600" />
                  )}
                </label>
                <input
                  type="password"
                  value={youtubeApiKey}
                  onChange={(e) => setYoutubeApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Kick Official API OAuth Token{" "}
                  {apiFlags.kick && (
                    <CheckCircle2 className="inline h-3 w-3 text-emerald-600" />
                  )}
                </label>
                <input
                  type="password"
                  value={kickApiToken}
                  onChange={(e) => setKickApiToken(e.target.value)}
                  placeholder="Official Kick v1 OAuth token"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </section>

          {/* Save & Reset Demo Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={resetting}
              onClick={() => void handleResetDemo()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition"
            >
              {resetting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reset Demo Sample Data
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition shadow-subtle"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save All Settings
            </button>
          </div>

          {/* 5. Saved Clip History */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-zinc-500" />
                <h2 className="text-sm font-extrabold text-zinc-950">
                  Saved Clips & Generation History ({clipHistory.length})
                </h2>
              </div>
              <Link
                href="/clips"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                Open Full Library
              </Link>
            </div>
            <div className="divide-y divide-zinc-100">
              {clipHistory.slice(0, 8).map((c) => (
                <div
                  key={c.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SourceBadge isDemo={c.isDemo} size="xs" />
                    <Link
                      href={`/editor?clip=${encodeURIComponent(c.id)}`}
                      className="font-semibold text-zinc-900 hover:text-blue-600 truncate"
                    >
                      {c.title}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500 shrink-0">
                    <span className="font-bold text-zinc-900">
                      {c.aiScore}/100
                    </span>
                    <span>
                      {c.aspectRatio} · {formatDuration(c.durationSeconds)}
                    </span>
                    <span>{formatRelativeTime(c.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </form>
      )}
    </StudioShell>
  );
}
