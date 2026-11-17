"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FolderCheck,
  Info,
  Music,
  Scissors,
  ShieldAlert,
  Smartphone,
  X,
  XCircle,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import type {
  AutoDownloadBundleEvent,
  ClipRecord,
  ProcessingJob,
  UserProfile,
  UserSettings,
} from "@/lib/types";

export interface ToastItem {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
}

export interface ActiveDownload {
  clipId: string;
  title: string;
  progress: number; // 0..100
  receivedBytes: number;
  totalBytes: number;
  status: "downloading" | "done" | "error";
  error?: string;
}

type WsListener = (event: string, payload: unknown) => void;

interface AppContextValue {
  user: UserProfile | null;
  settings: UserSettings | null;
  authLoading: boolean;
  wsConnected: boolean;
  jobs: ProcessingJob[];
  downloads: Record<string, ActiveDownload>;
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  signInDemo: () => Promise<boolean>;
  notify: (toast: Omit<ToastItem, "id">) => void;
  subscribeWs: (listener: WsListener) => () => void;
  requestDownload: (clip: ClipRecord, onDone?: () => void) => void;
  requestDownloadPair: (clipId: string, onDone?: () => void) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ActiveDownload>>(
    {}
  );
  const [copyrightPrompt, setCopyrightPrompt] = useState<{
    clip: ClipRecord;
    shortClip?: ClipRecord | null;
    isAutoHold?: boolean;
    hypeScore?: number;
    onDone?: () => void;
  } | null>(null);

  const listenersRef = useRef<Set<WsListener>>(new Set());
  const handledBundlesRef = useRef<Set<string>>(new Set());
  const autoDownloadHandlerRef = useRef<
    ((bundle: AutoDownloadBundleEvent) => void) | null
  >(null);

  const notify = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user || null);
        setSettings(data.settings || null);
      }
    } catch {
      // ignore transient network errors
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    await refreshAuth();
    notify({
      type: "info",
      title: "Signed out",
      description: "Your session has been closed.",
    });
  }, [notify, refreshAuth]);

  const signInDemo = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Demo sign-in failed.");
      setUser(data.user);
      setSettings(data.settings);
      notify({
        type: "success",
        title: `Signed in as ${data.user.displayName}`,
        description: "Demo Creator account active — clips and edits persist in DB.",
      });
      return true;
    } catch (err) {
      notify({
        type: "error",
        title: "Sign-in failed",
        description: err instanceof Error ? err.message : "Error",
      });
      return false;
    }
  }, [notify]);

  const subscribeWs = useCallback((listener: WsListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  // Real-time WebSocket connection using relative preview host (wss:// or ws://)
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped || typeof window === "undefined") return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${window.location.host}/api/ws`;
      try {
        ws = new WebSocket(url);
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
        return;
      }

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data));
          const ev = String(msg.event || "");
          const payload = msg.payload;

          if (ev === "job_update" && payload) {
            const job = payload as ProcessingJob;
            setJobs((prev) => {
              const filtered = prev.filter((j) => j.id !== job.id);
              return [job, ...filtered].slice(0, 8);
            });
          } else if (ev === "clip_created" && payload) {
            const clip = payload as ClipRecord;
            notify({
              type: clip.music.flagged ? "warning" : "success",
              title: clip.parentClipId && clip.aspectRatio === "9:16"
                ? `Auto 9:16 Short Ready · AI ${clip.aiScore}/100`
                : clip.isEdited
                ? `Edited MP4 Ready (${clip.aspectRatio})`
                : `Original 16:9 Saved · AI ${clip.aiScore}/100`,
              description: clip.music.flagged
                ? `${clip.title} — Music copyright warning flagged (audio preserved).`
                : `${clip.title} (${clip.durationSeconds}s)`,
            });
          } else if (ev === "auto_download_bundle" && payload) {
            const bundle = payload as AutoDownloadBundleEvent;
            autoDownloadHandlerRef.current?.(bundle);
          } else if (ev === "duplicate_suppressed" && payload) {
            const p = payload as { reason: string };
            notify({
              type: "info",
              title: "Duplicate Clip Prevented",
              description: p.reason,
            });
          }

          listenersRef.current.forEach((fn) => fn(ev, payload));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [notify]);

  const performStreamingDownload = useCallback(
    async (
      clip: ClipRecord,
      ackCopyright: boolean,
      onDone?: () => void,
      opts?: { skipLog?: boolean; silentToast?: boolean }
    ) => {
      setDownloads((prev) => ({
        ...prev,
        [clip.id]: {
          clipId: clip.id,
          title: clip.title,
          progress: 2,
          receivedBytes: 0,
          totalBytes: clip.fileSizeBytes || 0,
          status: "downloading",
        },
      }));

      try {
        const qs = new URLSearchParams();
        if (ackCopyright) qs.set("ackCopyright", "1");
        if (opts?.skipLog) qs.set("skipLog", "1");
        const querySuffix = qs.toString() ? `?${qs.toString()}` : "";

        const res = await fetch(
          `/api/clips/${encodeURIComponent(clip.id)}/download${querySuffix}`
        );

        if (res.status === 409) {
          setDownloads((prev) => {
            const copy = { ...prev };
            delete copy[clip.id];
            return copy;
          });
          setCopyrightPrompt({ clip, onDone });
          return;
        }

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `Export failed (HTTP ${res.status}).`);
        }

        const total =
          Number(res.headers.get("Content-Length") || 0) ||
          clip.fileSizeBytes ||
          1;
        const disposition = res.headers.get("Content-Disposition") || "";
        const fnMatch = disposition.match(/filename="([^"]+)"/);
        const filename = fnMatch?.[1] || `clipx-${clip.id}.mp4`;

        const reader = res.body?.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.byteLength;
              const pct = Math.min(99, Math.max(5, Math.round((received / total) * 100)));
              setDownloads((prev) => ({
                ...prev,
                [clip.id]: {
                  clipId: clip.id,
                  title: clip.title,
                  progress: pct,
                  receivedBytes: received,
                  totalBytes: total,
                  status: "downloading",
                },
              }));
            }
          }
        } else {
          const blobFallback = await res.blob();
          chunks.push(blobFallback);
          received = blobFallback.size;
        }

        const blob = new Blob(chunks, { type: "video/mp4" });
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

        setDownloads((prev) => ({
          ...prev,
          [clip.id]: {
            clipId: clip.id,
            title: clip.title,
            progress: 100,
            receivedBytes: received,
            totalBytes: Math.max(total, received),
            status: "done",
          },
        }));

        if (!opts?.silentToast) {
          notify({
            type: "success",
            title: "MP4 Export Saved & Downloaded",
            description: `${filename} (${formatBytes(received)})`,
          });
        }
        onDone?.();

        setTimeout(() => {
          setDownloads((prev) => {
            const copy = { ...prev };
            if (copy[clip.id]?.status === "done") delete copy[clip.id];
            return copy;
          });
        }, 4500);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Download failed.";
        setDownloads((prev) => ({
          ...prev,
          [clip.id]: {
            clipId: clip.id,
            title: clip.title,
            progress: 0,
            receivedBytes: 0,
            totalBytes: clip.fileSizeBytes || 0,
            status: "error",
            error: msg,
          },
        }));
        notify({
          type: "error",
          title: "MP4 Download Blocked",
          description: msg,
        });
      }
    },
    [notify]
  );

  const triggerStaggeredPairDownload = useCallback(
    (
      original: ClipRecord,
      short: ClipRecord | null | undefined,
      ackCopyright: boolean,
      onDone?: () => void
    ) => {
      void performStreamingDownload(
        original,
        ackCopyright,
        short ? undefined : onDone,
        { skipLog: true, silentToast: Boolean(short) }
      );
      if (short) {
        setTimeout(() => {
          void performStreamingDownload(short, ackCopyright, onDone, {
            skipLog: true,
            silentToast: true,
          });
        }, 850);
      }
    },
    [performStreamingDownload]
  );

  // Keep live WS auto-download handler wired to latest download function
  useEffect(() => {
    autoDownloadHandlerRef.current = (bundle: AutoDownloadBundleEvent) => {
      if (!bundle?.bundleId || handledBundlesRef.current.has(bundle.bundleId)) {
        return;
      }
      handledBundlesRef.current.add(bundle.bundleId);

      if (bundle.status === "copyright_hold") {
        // PAUSE automatic download and display copyright warning modal (audio untouched!)
        setCopyrightPrompt({
          clip: bundle.originalClip,
          shortClip: bundle.shortClip,
          isAutoHold: true,
          hypeScore: bundle.hypeScore,
        });
        notify({
          type: "warning",
          title: "Auto-Download Paused — Music Detected",
          description: bundle.shortClip
            ? `Saved Original 16:9 + 9:16 Short from ${bundle.channelName}. Confirm warning to download both (audio untouched).`
            : `Saved Original 16:9 from ${bundle.channelName}. Confirm warning to download (audio untouched).`,
        });
        return;
      }

      // Clean audio: saved to clipx-ai/exports/ AND auto-download BOTH MP4s to browser!
      triggerStaggeredPairDownload(
        bundle.originalClip,
        bundle.shortClip,
        false
      );
      notify({
        type: "success",
        title: bundle.shortClip
          ? `Auto-Downloaded Original 16:9 + 9:16 Short!`
          : `Auto-Downloaded Original 16:9 MP4!`,
        description: `${bundle.channelName} (Hype ${bundle.hypeScore}/100) — Saved to clipx-ai/exports/ & browser Downloads.`,
      });
    };
  }, [notify, triggerStaggeredPairDownload]);

  const executePairExport = useCallback(
    async (clipId: string, ackCopyright: boolean, onDone?: () => void) => {
      try {
        const res = await fetch(
          `/api/clips/${encodeURIComponent(clipId)}/export-pair`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ackCopyright }),
          }
        );
        const data = await res.json().catch(() => ({}));

        if (res.status === 409 && data.originalClip) {
          setCopyrightPrompt({
            clip: data.originalClip,
            shortClip: data.shortClip || null,
            isAutoHold: false,
            onDone,
          });
          return;
        }
        if (!res.ok) {
          throw new Error(data.error || `Export failed (HTTP ${res.status}).`);
        }

        const orig: ClipRecord = data.originalClip;
        const short: ClipRecord | null = data.shortClip || null;
        triggerStaggeredPairDownload(orig, short, ackCopyright, onDone);

        notify({
          type: "success",
          title: short
            ? "Downloading Both: Original 16:9 + 9:16 Short"
            : "Downloading Original 16:9 MP4",
          description: `Also saved to clipx-ai/exports/ (${
            (data.exportFiles || []).length || 1
          } MP4 file${(data.exportFiles || []).length === 2 ? "s" : ""}).`,
        });
      } catch (err) {
        notify({
          type: "error",
          title: "Pair Export Blocked",
          description: err instanceof Error ? err.message : "Download failed.",
        });
      }
    },
    [notify, triggerStaggeredPairDownload]
  );

  const requestDownloadPair = useCallback(
    async (clipId: string, onDone?: () => void) => {
      await executePairExport(clipId, false, onDone);
    },
    [executePairExport]
  );

  const requestDownload = useCallback(
    (clip: ClipRecord, onDone?: () => void) => {
      if (!clip.ownerAuthorized) {
        notify({
          type: "error",
          title: "Authorization Required",
          description:
            "You can only export clips that you own or are explicitly authorized to download.",
        });
        return;
      }
      const shouldWarn =
        clip.music.flagged && (settings?.warnBeforeCopyrightExport ?? true);
      if (shouldWarn) {
        setCopyrightPrompt({ clip, onDone });
        return;
      }
      void performStreamingDownload(clip, false, onDone);
    },
    [notify, performStreamingDownload, settings?.warnBeforeCopyrightExport]
  );

  const activeDownloadList = Object.values(downloads);

  return (
    <AppContext.Provider
      value={{
        user,
        settings,
        authLoading,
        wsConnected,
        jobs,
        downloads,
        refreshAuth,
        logout,
        signInDemo,
        notify,
        subscribeWs,
        requestDownload,
        requestDownloadPair,
      }}
    >
      {children}

      {/* Pre-Export / Hype Auto-Download Copyrighted Music Warning Modal (Audio Never Altered) */}
      {copyrightPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 backdrop-blur-[2px] p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white border border-zinc-200 shadow-elevated p-6">
            <div className="flex items-start gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 text-amber-600">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-zinc-950">
                  {copyrightPrompt.isAutoHold
                    ? "Auto-Download Paused — Copyrighted Music Warning"
                    : "Copyrighted Music Warning Before Export"}
                </h3>
                <p className="mt-1 text-sm text-zinc-600">
                  <span className="font-semibold text-zinc-900">
                    {copyrightPrompt.clip.title}
                  </span>{" "}
                  {copyrightPrompt.shortClip
                    ? "and its paired 9:16 Vertical Short were saved to your library, but auto-download paused because music was flagged ("
                    : "was flagged for potentially copyrighted music ("}
                  {copyrightPrompt.clip.music.confidence}% confidence).
                </p>
              </div>
              <button
                onClick={() => setCopyrightPrompt(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Close warning"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {copyrightPrompt.shortClip && (
              <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 rounded-lg bg-zinc-100 border border-zinc-200 px-2.5 py-1 text-zinc-800">
                  <FolderCheck className="h-3.5 w-3.5 text-emerald-600" />
                  Original 16:9 ({copyrightPrompt.clip.width}×{copyrightPrompt.clip.height})
                </span>
                <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-blue-800">
                  <Smartphone className="h-3.5 w-3.5 text-blue-600" />
                  Paired 9:16 Short ({copyrightPrompt.shortClip.width}×{copyrightPrompt.shortClip.height})
                </span>
              </div>
            )}

            <div className="mt-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 p-3.5 text-xs text-amber-950 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold">
                <Music className="h-3.5 w-3.5 text-amber-600" />
                <span>
                  {copyrightPrompt.clip.music.trackMatch ||
                    "Sustained Musical Backing Track Detected"}
                </span>
              </div>
              <p className="text-amber-900/90 leading-relaxed">
                {copyrightPrompt.clip.music.details}
              </p>
            </div>

            <div className="mt-3 rounded-xl bg-zinc-50 border border-zinc-200 px-3.5 py-2.5 text-xs text-zinc-600">
              <strong className="text-zinc-900">Audio Integrity Policy:</strong>{" "}
              CLIPX AI never automatically removes, mutes, or replaces your audio.
              Exporting below preserves 100% of the original audio track in{" "}
              {copyrightPrompt.shortClip ? "both MP4 files" : "your MP4 file"}.
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setCopyrightPrompt(null)}
                className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition"
              >
                {copyrightPrompt.isAutoHold
                  ? "Skip Auto-Download (Keep Saved)"
                  : "Cancel"}
              </button>
              <Link
                href={`/editor?clip=${encodeURIComponent(
                  copyrightPrompt.shortClip?.id || copyrightPrompt.clip.id
                )}`}
                onClick={() => setCopyrightPrompt(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 transition"
              >
                <Scissors className="h-3.5 w-3.5" />
                Open Editor
              </Link>
              <button
                onClick={() => {
                  const target = copyrightPrompt;
                  setCopyrightPrompt(null);
                  if (target.shortClip || target.isAutoHold) {
                    void executePairExport(target.clip.id, true, target.onDone);
                  } else {
                    void performStreamingDownload(
                      target.clip,
                      true,
                      target.onDone
                    );
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition shadow-subtle"
              >
                <Download className="h-3.5 w-3.5" />
                {copyrightPrompt.shortClip
                  ? "I Understand — Download Both (16:9 + 9:16)"
                  : "I Understand — Export Original MP4"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Download Progress Indicator */}
      {activeDownloadList.length > 0 && (
        <div className="fixed bottom-4 left-4 z-40 w-80 max-w-[calc(100vw-2rem)] space-y-2">
          {activeDownloadList.map((dl) => (
            <div
              key={dl.clipId}
              className="rounded-xl bg-white border border-zinc-200 shadow-elevated p-3.5 animate-fade-in"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-zinc-900 truncate">
                  {dl.title}
                </span>
                <span className="font-mono font-semibold text-blue-600 shrink-0">
                  {dl.status === "error" ? "Error" : `${dl.progress}%`}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={`h-full rounded-full transition-all duration-150 ${
                    dl.status === "error"
                      ? "bg-rose-500"
                      : dl.status === "done"
                      ? "bg-emerald-500"
                      : "bg-blue-600"
                  }`}
                  style={{ width: `${dl.status === "error" ? 100 : dl.progress}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                <span>
                  {dl.status === "done"
                    ? "MP4 saved to device"
                    : dl.status === "error"
                    ? dl.error
                    : "Downloading MP4..."}
                </span>
                {dl.totalBytes > 0 && (
                  <span className="font-mono">
                    {formatBytes(dl.receivedBytes)} / {formatBytes(dl.totalBytes)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast Notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-3 rounded-xl bg-white border border-zinc-200 shadow-elevated p-3.5 animate-fade-in"
            >
              {t.type === "success" && (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              )}
              {t.type === "error" && (
                <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
              )}
              {t.type === "warning" && (
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              )}
              {t.type === "info" && (
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-zinc-950">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs text-zinc-600 leading-snug">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                onClick={() => dismissToast(t.id)}
                className="text-zinc-400 hover:text-zinc-700"
                aria-label="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </AppContext.Provider>
  );
}
