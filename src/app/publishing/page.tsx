"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Instagram,
  Loader2,
  Youtube,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { StudioShell } from "@/components/StudioShell";
import { ScoreBar } from "@/components/ScoreBar";
import { formatRelativeTime } from "@/lib/format";
import type { ClipRecord, StreamRecord } from "@/lib/types";

interface SocialSettingsView {
  instagramUserId: string;
  instagramAccessToken: string;
  instagramApiVersion: string;
  instagramLoginMethod: "facebook" | "instagram";
  instagramTokenExpiresAt: string;
  metaAppId: string;
  metaAppSecret: string;
  storageMode: "builtin" | "s3";
  publicBaseUrl: string;
  youtubeConfigured: boolean;
  youtubeClientId: string;
  youtubeClientSecret: string;
  youtubeRefreshToken: string;
  youtubeChannelId: string;
  youtubeChannelTitle: string;
  youtubePrivacy: "public" | "unlisted" | "private";
  youtubeCategoryId: string;
  youtubeMadeForKids: boolean;
  youtubeAutoPublish: boolean;
  instagramAutoPublish: boolean;
  instagramShareToFeed: boolean;
  instagramHashtags: string;
  instagramConfigured: boolean;
  instagramReady: boolean;
  storageEndpoint: string;
  storageRegion: string;
  storageBucket: string;
  storageAccessKeyId: string;
  storageSecretAccessKey: string;
  storagePrefix: string;
  storagePublicBaseUrl: string;
  storageForcePathStyle: boolean;
  storageConfigured: boolean;
  storageReady: boolean;
}

interface SocialPostView {
  id: string;
  clipId: string;
  platform: string;
  status: string;
  mode: string;
  caption: string;
  permalink: string;
  error: string;
  createdAt: string;
  publishedAt: string | null;
}

const EMPTY_SETTINGS: SocialSettingsView = {
  instagramUserId: "",
  instagramAccessToken: "",
  instagramApiVersion: "",
  instagramLoginMethod: "facebook",
  instagramTokenExpiresAt: "",
  metaAppId: "",
  metaAppSecret: "",
  storageMode: "builtin",
  publicBaseUrl: "",
  youtubeConfigured: false,
  youtubeClientId: "",
  youtubeClientSecret: "",
  youtubeRefreshToken: "",
  youtubeChannelId: "",
  youtubeChannelTitle: "",
  youtubePrivacy: "public",
  youtubeCategoryId: "20",
  youtubeMadeForKids: false,
  youtubeAutoPublish: false,
  instagramAutoPublish: false,
  instagramShareToFeed: true,
  instagramHashtags: "#gaming #gamingclips #reels #clipxai",
  instagramConfigured: false,
  instagramReady: false,
  storageEndpoint: "",
  storageRegion: "auto",
  storageBucket: "",
  storageAccessKeyId: "",
  storageSecretAccessKey: "",
  storagePrefix: "clipx",
  storagePublicBaseUrl: "",
  storageForcePathStyle: true,
  storageConfigured: false,
  storageReady: false,
};

function SetupStep({
  n,
  done,
  title,
  detail,
  action,
}: {
  n: number;
  done: boolean;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          done ? "bg-emerald-100 text-emerald-700" : "bg-zinc-100 text-zinc-500"
        }`}
      >
        {done ? <CheckCircle2 size={14} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-0.5 text-[13px] text-zinc-600">{detail}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}

function StatusPill({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        ok
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-amber-50 text-amber-700 border border-amber-200"
      }`}
    >
      {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      {children}
    </span>
  );
}

export default function PublishingPage() {
  const { user, notify, subscribeWs } = useApp();
  const [settings, setSettings] = useState<SocialSettingsView>(EMPTY_SETTINGS);
  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [posts, setPosts] = useState<SocialPostView[]>([]);
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [testingStorage, setTestingStorage] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [captionDrafts, setCaptionDrafts] = useState<Record<string, string>>({});
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    username?: string;
    accountType?: string;
    quota?: { used: number; quota: number; remaining: number } | null;
    error?: string;
    help?: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [ytAdvancedOpen, setYtAdvancedOpen] = useState(false);
  const [verifyingYt, setVerifyingYt] = useState(false);
  const [ytResult, setYtResult] = useState<{
    ok: boolean;
    channel?: { title?: string; handle?: string; subscribers?: string };
    quota?: { uploadsPerDay: number };
    error?: string;
    hint?: string;
  } | null>(null);
  const [redirectUri, setRedirectUri] = useState(
    "/api/social/instagram/oauth/callback"
  );
  const [ytRedirectUri, setYtRedirectUri] = useState(
    "/api/social/youtube/oauth/callback"
  );
  const [connectBanner, setConnectBanner] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [storageResult, setStorageResult] = useState<{
    ok: boolean;
    publicUrl?: string;
    error?: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [settingsRes, clipsRes, postsRes, streamsRes] = await Promise.all([
        fetch("/api/social/settings", { cache: "no-store" }),
        fetch("/api/clips", { cache: "no-store" }),
        fetch("/api/social/posts", { cache: "no-store" }),
        fetch("/api/streams", { cache: "no-store" }),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings((prev) => ({ ...EMPTY_SETTINGS, ...prev, ...data.settings }));
      }
      if (clipsRes.ok) {
        const data = await clipsRes.json();
        setClips(data.clips || []);
      }
      if (postsRes.ok) {
        const data = await postsRes.json();
        setPosts(data.posts || []);
      }
      if (streamsRes.ok) {
        const data = await streamsRes.json();
        setStreams(data.streams || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void loadAll();
  }, [user, loadAll]);

  useEffect(() => {
    setRedirectUri(
      `${window.location.origin}/api/social/instagram/oauth/callback`
    );
    setYtRedirectUri(
      `${window.location.origin}/api/social/youtube/oauth/callback`
    );
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connect = params.get("connect");
    if (connect === "ok") {
      setConnectBanner({ ok: true, message: "Instagram connected. Run Test connection to confirm." });
    } else if (connect === "error") {
      setConnectBanner({
        ok: false,
        message: params.get("message") || "Instagram sign-in did not complete.",
      });
    }
    if (connect) {
      window.history.replaceState({}, "", "/publishing");
    }
  }, []);

  useEffect(() => {
    return subscribeWs((event, payload) => {
      if (event === "social_post_updated" && payload) {
        const post = payload as SocialPostView;
        setPosts((prev) => {
          const rest = prev.filter((p) => p.id !== post.id);
          return [post, ...rest];
        });
        if (post.status === "published") {
          notify({
            type: "success",
            title: "Published to Instagram",
            description: post.permalink || "Reel is live.",
          });
        }
        if (post.status === "failed") {
          notify({
            type: "error",
            title: "Instagram publish failed",
            description: post.error,
          });
        }
      }
    });
  }, [notify, subscribeWs]);

  const shorts = useMemo(
    () =>
      clips
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .sort((a, b) => (b.aspectRatio === "9:16" ? 1 : 0) - (a.aspectRatio === "9:16" ? 1 : 0)),
    [clips]
  );

  const patch = <K extends keyof SocialSettingsView>(
    key: K,
    value: SocialSettingsView[K]
  ) => setSettings((prev) => ({ ...prev, [key]: value }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/social/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instagramUserId: settings.instagramUserId,
          instagramAccessToken: settings.instagramAccessToken,
          instagramApiVersion: settings.instagramApiVersion,
          instagramLoginMethod: settings.instagramLoginMethod,
          metaAppId: settings.metaAppId,
          metaAppSecret: settings.metaAppSecret,
          storageMode: settings.storageMode,
          publicBaseUrl: settings.publicBaseUrl,
          youtubeClientId: settings.youtubeClientId,
          youtubeClientSecret: settings.youtubeClientSecret,
          youtubeRefreshToken: settings.youtubeRefreshToken,
          youtubePrivacy: settings.youtubePrivacy,
          youtubeCategoryId: settings.youtubeCategoryId,
          youtubeMadeForKids: settings.youtubeMadeForKids,
          youtubeAutoPublish: settings.youtubeAutoPublish,
          instagramAutoPublish: settings.instagramAutoPublish,
          instagramShareToFeed: settings.instagramShareToFeed,
          instagramHashtags: settings.instagramHashtags,
          storageEndpoint: settings.storageEndpoint,
          storageRegion: settings.storageRegion,
          storageBucket: settings.storageBucket,
          storageAccessKeyId: settings.storageAccessKeyId,
          storageSecretAccessKey: settings.storageSecretAccessKey,
          storagePrefix: settings.storagePrefix,
          storagePublicBaseUrl: settings.storagePublicBaseUrl,
          storageForcePathStyle: settings.storageForcePathStyle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save publishing settings.");
      setSettings((prev) => ({ ...prev, ...data.settings }));
      notify({
        type: "success",
        title: "Saved",
        description: data.settings.instagramReady
          ? "Instagram is connected. Run the check to confirm it can post."
          : "Next: connect Instagram so it can post for you.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  const tokenExpiringSoon = useMemo(() => {
    if (!settings.instagramTokenExpiresAt) return false;
    const ms = Date.parse(settings.instagramTokenExpiresAt);
    if (Number.isNaN(ms)) return false;
    return ms - Date.now() < 7 * 24 * 60 * 60 * 1000;
  }, [settings.instagramTokenExpiresAt]);

  function startConnect() {
    if (!settings.metaAppId || !settings.metaAppSecret) {
      setAdvancedOpen(true);
      notify({
        type: "info",
        title: "Add your Meta app id + secret first",
        description:
          "Both values are on your Meta app page under App settings → Basic. They are stored server-side and never sent back to the browser.",
      });
      return;
    }
    window.location.href = "/api/social/instagram/oauth/start";
  }

  function startYouTubeConnect() {
    if (!settings.youtubeClientId || !settings.youtubeClientSecret) {
      setYtAdvancedOpen(true);
      notify({
        type: "info",
        title: "Add your Google OAuth client id + secret first",
        description:
          "Create them in Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application). Stored server-side.",
      });
      return;
    }
    window.location.href = "/api/social/youtube/oauth/start";
  }

  async function handleVerifyYouTube() {
    setVerifyingYt(true);
    setYtResult(null);
    try {
      const res = await fetch("/api/social/youtube/verify", { method: "POST" });
      const data = await res.json();
      setYtResult(data);
      notify({
        type: data.ok ? "success" : "warning",
        title: data.ok
          ? `YouTube: ${data.channel?.title || "connected"}`
          : "YouTube check failed",
        description: data.ok
          ? `About ${data.quota?.uploadsPerDay ?? 6} uploads/day on the free API quota.`
          : data.error,
      });
      void loadAll();
    } catch (err) {
      notify({
        type: "error",
        title: "YouTube check failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setVerifyingYt(false);
    }
  }

  async function handleRefreshToken() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/social/instagram/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Refresh failed.");
      setSettings((prev) => ({ ...prev, instagramTokenExpiresAt: data.expiresAt }));
      notify({
        type: "success",
        title: "Token refreshed",
        description: data.expiresAt
          ? `Valid until ${new Date(data.expiresAt).toLocaleDateString()}.`
          : "The new token has no reported expiry.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Could not refresh the token",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/social/instagram/verify", { method: "POST" });
      const data = await res.json();
      setVerifyResult(data);
      notify({
        type: data.ok ? "success" : "warning",
        title: data.ok
          ? `Connected as @${data.username || "instagram"}`
          : "Instagram check failed",
        description: data.ok
          ? `${data.accountType || "professional"} account · ${
              data.quota ? `${data.quota.remaining}/${data.quota.quota} posts left today` : "quota unknown"
            }`
          : data.error,
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleTestStorage() {
    setTestingStorage(true);
    setStorageResult(null);
    try {
      const res = await fetch("/api/social/storage/test", { method: "POST" });
      const data = await res.json();
      setStorageResult(data);
      notify({
        type: data.ok ? "success" : "error",
        title: data.ok ? "Bucket reachable" : "Bucket test failed",
        description: data.ok ? "Upload + public download succeeded." : data.error,
      });
    } finally {
      setTestingStorage(false);
    }
  }

  async function handlePublish(
    clip: ClipRecord,
    platform: "instagram" | "youtube" = "instagram"
  ) {
    setPublishingId(`${clip.id}:${platform}`);
    try {
      const res = await fetch(`/api/clips/${encodeURIComponent(clip.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          caption: captionDrafts[clip.id]?.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed.");
      notify({
        type: "success",
        title: platform === "youtube" ? "Short uploaded" : "Reel published",
        description:
          data.post?.permalink ||
          (platform === "youtube"
            ? "YouTube accepted the upload."
            : "Instagram accepted the post."),
      });
      void loadAll();
    } catch (err) {
      notify({
        type: "error",
        title: "Publish failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setPublishingId(null);
    }
  }

  async function setStreamOverride(streamId: string, value: number) {
    try {
      const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "configure", autoPublishEnabled: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update the stream.");
      setStreams((prev) =>
        prev.map((stream) =>
          stream.id === streamId
            ? { ...stream, autoPublishEnabled: value }
            : stream
        )
      );
      notify({
        type: "success",
        title: "Stream updated",
        description:
          value === 1
            ? "This stream will auto-publish every Short."
            : value === 0
            ? "Auto-publish is off for this stream."
            : "This stream now follows the account default.",
      });
    } catch (err) {
      notify({
        type: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function latestPost(clipId: string, platform = "instagram"): SocialPostView | undefined {
    return posts.find((p) => p.clipId === clipId && p.platform === platform);
  }

  if (!user) {
    return (
      <StudioShell
        title="Publishing"
        subtitle="Push your generated Shorts straight to Instagram Reels"
      >
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
          <Instagram className="mx-auto mb-3 text-zinc-400" size={28} />
          <h2 className="text-lg font-semibold text-zinc-900">Sign in to connect Instagram</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
            Publishing settings are stored per account. Use the demo login to explore
            the flow, or create your own account.
          </p>
          <Link
            href="/auth"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Go to sign in
          </Link>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      title="Publishing"
      subtitle="Automatic Instagram Reels upload for your generated 9:16 Shorts"
      actions={
        <button
          type="button"
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      }
    >
      <div className="space-y-6">
        {/* ---------- Setup status ---------- */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-900">Setup</h2>
          <p className="mt-1 text-[13px] text-zinc-600">
            Two steps and your Shorts post themselves. Everything else is optional.
          </p>
          <ol className="mt-4 space-y-3">
            <SetupStep
              n={1}
              done={settings.instagramReady}
              title="Connect Instagram"
              detail={
                settings.instagramReady
                  ? "Connected. Posting is allowed on this account."
                  : "One click with a Meta app id + secret, or paste a token under Advanced."
              }
              action={
                settings.instagramReady ? null : (
                  <button
                    type="button"
                    onClick={startConnect}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    <Instagram size={14} /> Connect Instagram
                  </button>
                )
              }
            />
            <SetupStep
              n={2}
              done={settings.youtubeConfigured}
              title="Connect YouTube (optional)"
              detail={
                settings.youtubeConfigured
                  ? "YouTube connected — Shorts upload straight from this server, no bucket."
                  : "Same idea: click Connect, approve in Google. Only needed if you want Shorts there too."
              }
              action={null}
            />
            <SetupStep
              n={3}
              done={settings.storageReady}
              title="Choose where videos are hosted"
              detail={
                settings.storageMode === "builtin"
                  ? settings.publicBaseUrl
                    ? `Hosted by this app at ${settings.publicBaseUrl} — nothing else to set up.`
                    : "Uses this app's own URL — set it once below."
                  : "Uploaded to your S3-compatible bucket."
              }
              action={null}
            />
          </ol>
          {connectBanner && (
            <div
              className={`mt-4 rounded-lg border p-3 text-[13px] ${
                connectBanner.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              <div className="flex items-start gap-2">
                {connectBanner.ok ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                )}
                <span className="break-words">{connectBanner.message}</span>
              </div>
            </div>
          )}
        </section>

        {/* ---------- Instagram ---------- */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Instagram size={18} className="text-pink-600" />
              <h2 className="text-base font-semibold text-zinc-900">Instagram account</h2>
              <StatusPill ok={settings.instagramReady}>
                {settings.instagramReady ? "Credentials saved" : "Not connected"}
              </StatusPill>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={startConnect}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                <Instagram size={14} />
                {settings.instagramReady ? "Reconnect" : "Connect Instagram"}
              </button>
              {settings.instagramLoginMethod === "instagram" && settings.instagramReady && (
                <button
                  type="button"
                  onClick={() => void handleRefreshToken()}
                  disabled={refreshing}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Refresh token
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={verifying || !settings.instagramReady}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Test connection
              </button>
            </div>
          </div>

          <p className="mt-2 text-[13px] text-zinc-600">
            Instagram must be a <strong>Business</strong> or <strong>Creator</strong> account
            (Settings → Account type in the Instagram app). Personal accounts cannot post
            through any API — the app tells you if it finds one.
          </p>
          {settings.instagramTokenExpiresAt && (
            <p
              className={`mt-1 text-[12px] ${
                tokenExpiringSoon ? "font-medium text-amber-700" : "text-zinc-500"
              }`}
            >
              {tokenExpiringSoon ? "⚠ " : ""}Token expires{" "}
              {formatRelativeTime(settings.instagramTokenExpiresAt)}
              {settings.instagramLoginMethod === "instagram"
                ? " — refresh it above."
                : " — re-connect before then."}
            </p>
          )}

          {verifyResult && (
            <div
              className={`mt-3 rounded-lg border p-3 text-[13px] ${
                verifyResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {verifyResult.ok ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CheckCircle2 size={14} />
                  <span className="font-medium">@{verifyResult.username}</span>
                  <span className="text-emerald-700/80">{verifyResult.accountType}</span>
                  {verifyResult.quota && (
                    <span className="text-emerald-700/80">
                      {verifyResult.quota.remaining}/{verifyResult.quota.quota} posts left in 24h
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-start gap-2 font-medium">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {verifyResult.error}
                  </div>
                  {verifyResult.help && (
                    <p className="text-amber-800/80">{verifyResult.help}</p>
                  )}
                </div>
              )}
            </div>
          )}

          <details
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
            className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3"
          >
            <summary className="cursor-pointer text-[13px] font-medium text-zinc-700">
              Advanced — Meta app credentials or a manually pasted token
              {!settings.instagramReady && !settings.metaAppId && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  needed for one-click
                </span>
              )}
            </summary>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Add the app id + secret from your Meta app and the Connect button above does the
              rest (it fetches the account id and a 60-day token for you). Only paste a token
              manually if you already made one in the Meta dashboard.
            </p>
            <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-2.5">
              <p className="text-[11px] text-zinc-600">
                Add this exact URL to your Meta app → <em>Instagram → API setup with
                Instagram login → Business login settings → Valid OAuth redirect URIs</em>:
              </p>
              <div className="mt-1 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-700">
                  {redirectUri}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(redirectUri);
                    notify({ type: "success", title: "Copied redirect URI" });
                  }}
                  className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Copy
                </button>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">Meta app id</span>
                <input
                  value={settings.metaAppId}
                  onChange={(e) => patch("metaAppId", e.target.value)}
                  placeholder="1234567890"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Meta app secret
                </span>
                <input
                  type="password"
                  value={settings.metaAppSecret}
                  onChange={(e) => patch("metaAppSecret", e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
            </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Instagram user ID
              </span>
              <input
                value={settings.instagramUserId}
                onChange={(e) => patch("instagramUserId", e.target.value)}
                placeholder="17841400000000000"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Long-lived access token
              </span>
              <input
                type="password"
                value={settings.instagramAccessToken}
                onChange={(e) => patch("instagramAccessToken", e.target.value)}
                placeholder="EAAG…"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Hashtags for auto captions
              </span>
              <input
                value={settings.instagramHashtags}
                onChange={(e) => patch("instagramHashtags", e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Login path used for the token
              </span>
              <select
                value={settings.instagramLoginMethod}
                onChange={(e) =>
                  patch(
                    "instagramLoginMethod",
                    e.target.value as "facebook" | "instagram"
                  )
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                <option value="facebook">Facebook Login (graph.facebook.com · needs a Page)</option>
                <option value="instagram">Instagram Login (graph.instagram.com · no Page)</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Graph API version
              </span>
              <input
                value={settings.instagramApiVersion}
                onChange={(e) => patch("instagramApiVersion", e.target.value)}
                placeholder="v23.0 (default)"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            Facebook Login needs <code>instagram_basic</code> +{" "}
            <code>instagram_content_publish</code>. Instagram Login needs{" "}
            <code>instagram_business_basic</code> +{" "}
            <code>instagram_business_content_publish</code> and skips the Facebook Page
            entirely. Pick whichever path you used to generate the token — publishing
            endpoints are identical.
          </p>
          </details>

          <div className="mt-4 space-y-2">
            <label className="flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={settings.instagramAutoPublish}
                onChange={(e) => patch("instagramAutoPublish", e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Auto-publish every generated Short</strong> — hands-free posting.
                Individual streams can override this below.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={settings.instagramShareToFeed}
                onChange={(e) => patch("instagramShareToFeed", e.target.checked)}
                className="mt-0.5"
              />
              <span>Also show the Reel in the main profile feed</span>
            </label>
          </div>
        </section>

        {/* ---------- YouTube ---------- */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Youtube size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-zinc-900">YouTube Shorts</h2>
              <StatusPill ok={settings.youtubeConfigured}>
                {settings.youtubeConfigured
                  ? settings.youtubeChannelTitle
                    ? `@${settings.youtubeChannelTitle}`
                    : "Connected"
                  : "Not connected"}
              </StatusPill>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={startYouTubeConnect}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Youtube size={14} />
                {settings.youtubeConfigured ? "Reconnect YouTube" : "Connect YouTube"}
              </button>
              <button
                type="button"
                onClick={() => void handleVerifyYouTube()}
                disabled={verifyingYt || !settings.youtubeConfigured}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifyingYt ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                Test connection
              </button>
            </div>
          </div>

          <p className="mt-2 text-[13px] text-zinc-600">
            YouTube accepts the file directly, so this needs no bucket. Vertical Shorts land on
            the channel as Shorts; each upload costs 1,600 of the 10,000 free daily API units,
            i.e. about <strong>{6} uploads a day</strong>.
          </p>

          {ytResult && (
            <div
              className={`mt-3 rounded-lg border p-3 text-[13px] ${
                ytResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800"
              }`}
            >
              {ytResult.ok ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CheckCircle2 size={14} />
                  <span className="font-medium">{ytResult.channel?.title}</span>
                  {ytResult.channel?.subscribers && (
                    <span className="text-emerald-700/80">
                      {ytResult.channel.subscribers} subscribers
                    </span>
                  )}
                  <span className="text-emerald-700/80">
                    ~{ytResult.quota?.uploadsPerDay ?? 6} uploads/day
                  </span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-start gap-2 font-medium">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    {ytResult.error}
                  </div>
                  {ytResult.hint && <p className="text-amber-800/80">{ytResult.hint}</p>}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Visibility</span>
              <select
                value={settings.youtubePrivacy}
                onChange={(e) =>
                  patch("youtubePrivacy", e.target.value as "public" | "unlisted" | "private")
                }
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Category</span>
              <select
                value={settings.youtubeCategoryId}
                onChange={(e) => patch("youtubeCategoryId", e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              >
                <option value="20">Gaming</option>
                <option value="24">Entertainment</option>
                <option value="17">Sports</option>
                <option value="22">People &amp; Blogs</option>
                <option value="10">Music</option>
              </select>
            </label>
          </div>

          <div className="mt-3 space-y-2">
            <label className="flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={settings.youtubeAutoPublish}
                onChange={(e) => patch("youtubeAutoPublish", e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong>Auto-upload every generated Short</strong> — hands-free Shorts, works
                alongside Instagram.
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={settings.youtubeMadeForKids}
                onChange={(e) => patch("youtubeMadeForKids", e.target.checked)}
                className="mt-0.5"
              />
              <span>Made for kids (limits features; leave off for gaming clips)</span>
            </label>
          </div>

          <details
            open={ytAdvancedOpen}
            onToggle={(e) => setYtAdvancedOpen((e.target as HTMLDetailsElement).open)}
            className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3"
          >
            <summary className="cursor-pointer text-[13px] font-medium text-zinc-700">
              Advanced — Google OAuth client credentials or a pasted refresh token
              {!settings.youtubeConfigured && !settings.youtubeClientId && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  needed for one-click
                </span>
              )}
            </summary>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Google Cloud Console → APIs &amp; Services → enable <em>YouTube Data API v3</em> →
              Credentials → <em>OAuth client ID</em> (Web application) → add this redirect URI:
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-zinc-700">
                {ytRedirectUri}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(ytRedirectUri);
                  notify({ type: "success", title: "Copied redirect URI" });
                }}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Copy
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Google client id
                </span>
                <input
                  value={settings.youtubeClientId}
                  onChange={(e) => patch("youtubeClientId", e.target.value)}
                  placeholder="1234-abcd.apps.googleusercontent.com"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Google client secret
                </span>
                <input
                  type="password"
                  value={settings.youtubeClientSecret}
                  onChange={(e) => patch("youtubeClientSecret", e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Refresh token (only if you already have one)
                </span>
                <input
                  type="password"
                  value={settings.youtubeRefreshToken}
                  onChange={(e) => patch("youtubeRefreshToken", e.target.value)}
                  placeholder="1//…"
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                />
              </label>
            </div>
          </details>
        </section>

        {/* ---------- Storage ---------- */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Cloud size={18} className="text-sky-600" />
              <h2 className="text-base font-semibold text-zinc-900">Video hosting</h2>
              <StatusPill ok={settings.storageReady}>
                {settings.storageReady ? "Configured" : "Not configured"}
              </StatusPill>
            </div>
            <button
              type="button"
              onClick={() => void handleTestStorage()}
              disabled={testingStorage || !settings.storageReady}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {testingStorage ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
              Test hosting
            </button>
          </div>

          <p className="mt-2 text-[13px] text-zinc-600">
            Instagram downloads each Reel from a URL, so the file needs a public address.
            Leave this on <strong>This app</strong> and there is nothing to sign up for.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => patch("storageMode", "builtin")}
              className={`rounded-lg border p-3 text-left text-[13px] ${
                settings.storageMode === "builtin"
                  ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-200"
                  : "border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-zinc-900">
                <CheckCircle2 size={14} className={settings.storageMode === "builtin" ? "text-brand-600" : "text-zinc-300"} />
                This app (recommended)
              </span>
              <span className="mt-1 block text-zinc-600">
                Serves each Short through a signed link that expires in 24 h. No bucket, no
                extra account.
              </span>
            </button>
            <button
              type="button"
              onClick={() => patch("storageMode", "s3")}
              className={`rounded-lg border p-3 text-left text-[13px] ${
                settings.storageMode === "s3"
                  ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-200"
                  : "border-zinc-200 hover:bg-zinc-50"
              }`}
            >
              <span className="flex items-center gap-2 font-semibold text-zinc-900">
                <CheckCircle2 size={14} className={settings.storageMode === "s3" ? "text-brand-600" : "text-zinc-300"} />
                S3-compatible bucket
              </span>
              <span className="mt-1 block text-zinc-600">
                AWS S3, Cloudflare R2, Backblaze B2 or MinIO. Better for many uploads or when
                the app sits behind a lazy proxy.
              </span>
            </button>
          </div>

          {settings.storageMode === "builtin" && (
            <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Public address of this app (what Instagram will call)
                </span>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={settings.publicBaseUrl}
                    onChange={(e) => patch("publicBaseUrl", e.target.value)}
                    placeholder="https://clips.yourdomain.com"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
                  />
                  <button
                    type="button"
                    onClick={() => patch("publicBaseUrl", window.location.origin)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Use current address
                  </button>
                </div>
              </label>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Saved automatically the first time you save from the address you deploy on.
                Needs to be reachable from the internet over HTTPS — localhost works for
                testing the flow, but Instagram cannot download from it.
              </p>
            </div>
          )}

          {storageResult && (
            <div
              className={`mt-3 rounded-lg border p-3 text-[13px] ${
                storageResult.ok
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {storageResult.ok ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                  <span className="break-all">
                    Upload + download OK — {storageResult.publicUrl}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <XCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{storageResult.error}</span>
                </div>
              )}
            </div>
          )}

          {settings.storageMode === "s3" && (
            <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Endpoint</span>
              <input
                value={settings.storageEndpoint}
                onChange={(e) => patch("storageEndpoint", e.target.value)}
                placeholder="https://<account>.r2.cloudflarestorage.com"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Region (use <code>auto</code> for R2)
              </span>
              <input
                value={settings.storageRegion}
                onChange={(e) => patch("storageRegion", e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Bucket</span>
              <input
                value={settings.storageBucket}
                onChange={(e) => patch("storageBucket", e.target.value)}
                placeholder="clipx-clips"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Key prefix</span>
              <input
                value={settings.storagePrefix}
                onChange={(e) => patch("storagePrefix", e.target.value)}
                placeholder="clipx"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Access key ID</span>
              <input
                value={settings.storageAccessKeyId}
                onChange={(e) => patch("storageAccessKeyId", e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Secret access key</span>
              <input
                type="password"
                value={settings.storageSecretAccessKey}
                onChange={(e) => patch("storageSecretAccessKey", e.target.value)}
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-zinc-600">
                Public base URL (optional — for a public bucket or CDN)
              </span>
              <input
                value={settings.storagePublicBaseUrl}
                onChange={(e) => patch("storagePublicBaseUrl", e.target.value)}
                placeholder="https://cdn.example.com"
                className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
            </label>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={settings.storageForcePathStyle}
              onChange={(e) => patch("storageForcePathStyle", e.target.checked)}
              className="mt-0.5"
            />
            Path-style URLs (needed for MinIO and most non-AWS providers)
          </label>
            </>
          )}

          <p className="mt-3 text-[12px] text-zinc-500">
            Credentials are stored server-side and never returned to the browser. On shared
            deployments prefer environment variables: <code>IG_USER_ID</code>,{" "}
            <code>IG_ACCESS_TOKEN</code>, <code>IG_APP_ID</code>, <code>IG_APP_SECRET</code>,{" "}
            <code>PUBLIC_BASE_URL</code>, and for bucket mode <code>S3_ENDPOINT</code>,{" "}
            <code>S3_BUCKET</code>, <code>S3_ACCESS_KEY_ID</code>,{" "}
            <code>S3_SECRET_ACCESS_KEY</code>.
          </p>
        </section>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>

        {/* ---------- Per-stream overrides ---------- */}
        {streams.filter((stream) => stream.userId === user.id).length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-900">Per-stream overrides</h2>
            <p className="mt-1 text-[13px] text-zinc-600">
              Auto-publish follows the account switch above unless a stream overrides it.
            </p>
            <div className="mt-3 space-y-2">
              {streams
                .filter((stream) => stream.userId === user.id)
                .map((stream) => (
                  <div
                    key={stream.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">
                        {stream.title}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {stream.channelName} · {stream.platform}
                      </p>
                    </div>
                    <select
                      value={stream.autoPublishEnabled ?? -1}
                      onChange={(e) =>
                        void setStreamOverride(stream.id, Number(e.target.value))
                      }
                      className="rounded-lg border border-zinc-200 px-2 py-1.5 text-[13px]"
                    >
                      <option value={-1}>
                        Follow account default ({settings.instagramAutoPublish ? "on" : "off"})
                      </option>
                      <option value={1}>Always auto-publish</option>
                      <option value={0}>Never auto-publish</option>
                    </select>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* ---------- Clips ---------- */}
        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-zinc-900">Publish a clip</h2>
            <span className="text-xs text-zinc-500">
              {shorts.filter((c) => c.aspectRatio === "9:16").length} vertical Shorts ready
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-zinc-500">
              <Loader2 size={14} className="animate-spin" /> Loading clips…
            </div>
          ) : shorts.length === 0 ? (
            <p className="py-6 text-sm text-zinc-500">
              No clips yet — capture one from{" "}
              <Link href="/monitoring" className="text-brand-600 underline">
                Live Monitoring
              </Link>
              .
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {shorts.slice(0, 8).map((clip) => {
                const post = latestPost(clip.id, "instagram");
                const ytPost = latestPost(clip.id, "youtube");
                const isPublishing = publishingId === `${clip.id}:instagram`;
                const isUploadingYt = publishingId === `${clip.id}:youtube`;
                const vertical = clip.aspectRatio === "9:16";
                return (
                  <div
                    key={clip.id}
                    className="rounded-lg border border-zinc-200 p-3 sm:flex sm:gap-4"
                  >
                    <div className="sm:w-40 sm:shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={clip.posterUrl}
                        alt={clip.title}
                        className="aspect-video w-full rounded-md object-cover"
                      />
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium ${
                            vertical
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-zinc-100 text-zinc-600"
                          }`}
                        >
                          {clip.aspectRatio}
                        </span>
                        <span>{clip.durationSeconds.toFixed(0)}s</span>
                        <span>{clip.gameName}</span>
                      </div>
                    </div>

                    <div className="mt-3 min-w-0 flex-1 sm:mt-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-zinc-900">{clip.title}</h3>
                        <ScoreBar score={clip.aiScore} compact />
                      </div>

                      <textarea
                        value={
                          captionDrafts[clip.id] ??
                          `${clip.title} 🎮\n\n${clip.gameName} · AI hype ${clip.aiScore}/100\n\n${settings.instagramHashtags}`
                        }
                        onChange={(e) =>
                          setCaptionDrafts((prev) => ({ ...prev, [clip.id]: e.target.value }))
                        }
                        rows={3}
                        className="mt-2 w-full rounded-lg border border-zinc-200 px-3 py-2 text-[13px] outline-none focus:border-brand-400"
                      />

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePublish(clip, "instagram")}
                          disabled={
                            isPublishing ||
                            !settings.instagramReady ||
                            !settings.storageReady ||
                            post?.status === "processing" ||
                            post?.status === "creating" ||
                            post?.status === "hosting"
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPublishing ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Send size={14} />
                          )}
                          {post?.status === "published" ? "Republish Reel" : "Publish to Instagram"}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handlePublish(clip, "youtube")}
                          disabled={
                            isUploadingYt ||
                            !settings.youtubeConfigured ||
                            ytPost?.status === "uploading" ||
                            ytPost?.status === "processing"
                          }
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                          title={
                            settings.youtubeConfigured
                              ? "Upload as a YouTube Short"
                              : "Connect YouTube first"
                          }
                        >
                          {isUploadingYt ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Youtube size={14} />
                          )}
                          {ytPost?.status === "published" ? "Re-upload Short" : "Upload Short"}
                        </button>

                        {!vertical && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <AlertTriangle size={11} /> Landscape — the Reel will be letterboxed
                          </span>
                        )}

                        {ytPost && (
                          <span className="text-[11px] text-zinc-500">
                            {ytPost.status === "published" ? (
                              <a
                                href={ytPost.permalink || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-700 underline"
                              >
                                YouTube {formatRelativeTime(ytPost.publishedAt || ytPost.createdAt)}
                                <ExternalLink size={10} />
                              </a>
                            ) : ytPost.status === "failed" ? (
                              <span className="text-red-600">{ytPost.error}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <Loader2 size={10} className="animate-spin" />
                                YouTube {ytPost.status}…
                              </span>
                            )}
                          </span>
                        )}

                        {post && (
                          <span className="text-[11px] text-zinc-500">
                            {post.status === "published" ? (
                              <a
                                href={post.permalink || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-700 underline"
                              >
                                Published {formatRelativeTime(post.publishedAt || post.createdAt)}
                                <ExternalLink size={10} />
                              </a>
                            ) : post.status === "failed" ? (
                              <span className="text-red-600">{post.error}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-amber-700">
                                <Loader2 size={10} className="animate-spin" />
                                {post.status}…
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- History ---------- */}
        {posts.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="text-base font-semibold text-zinc-900">Publishing history</h2>
            <div className="mt-3 divide-y divide-zinc-100">
              {posts.slice(0, 10).map((post) => (
                <div key={post.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                  <div className="min-w-0">
                    <span
                      className={`mr-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        post.platform === "youtube"
                          ? "bg-red-50 text-red-700"
                          : "bg-pink-50 text-pink-700"
                      }`}
                    >
                      {post.platform === "youtube" ? "YouTube" : "Instagram"}
                    </span>
                    <span
                      className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        post.status === "published"
                          ? "bg-emerald-50 text-emerald-700"
                          : post.status === "failed"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {post.status}
                    </span>
                    <span className="text-zinc-600">
                      {post.mode === "auto" ? "Auto" : "Manual"} ·{" "}
                      {formatRelativeTime(post.publishedAt || post.createdAt)}
                    </span>
                    {post.error && (
                      <p className="mt-0.5 truncate text-[12px] text-red-600">{post.error}</p>
                    )}
                  </div>
                  {post.permalink && (
                    <a
                      href={post.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-brand-600 underline"
                    >
                      {post.platform === "youtube" ? "View Short" : "View Reel"}{" "}
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </StudioShell>
  );
}
