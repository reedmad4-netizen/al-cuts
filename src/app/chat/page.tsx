"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Flame,
  Loader2,
  MessageSquare,
  Play,
  Send,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import { SourceBadge, StreamStatusBadge } from "@/components/Badges";
import { StudioShell } from "@/components/StudioShell";
import { formatRelativeTime, platformLabel } from "@/lib/format";
import type {
  ChatMessageRecord,
  ChatSurgeRecord,
  LiveBufferState,
  StreamRecord,
} from "@/lib/types";

interface VelocityPoint {
  time: string;
  ratePerMin: number;
  baseline: number;
  isSpike: boolean;
}

export default function ChatActivityPage() {
  const { notify, subscribeWs } = useApp();
  const [streamId, setStreamId] = useState("stream-demo-sandbox");
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [surges, setSurges] = useState<ChatSurgeRecord[]>([]);
  const [topKeywords, setTopKeywords] = useState<
    Array<{ keyword: string; count: number }>
  >([]);
  const [velocity, setVelocity] = useState<VelocityPoint[]>([]);
  const [buffer, setBuffer] = useState<LiveBufferState | null>(null);
  const [multiplierThreshold, setMultiplierThreshold] = useState(2.6);
  const [testInput, setTestInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const autoPickedRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const loadChat = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/chat?streamId=${encodeURIComponent(streamId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const data = await res.json();
      const streamList: StreamRecord[] = data.streams || [];
      setStreams(streamList);
      // Auto-select an active real live stream on initial page visit
      if (!autoPickedRef.current) {
        autoPickedRef.current = true;
        const activeLive = streamList.find(
          (s) => !s.isDemo && s.status === "monitoring"
        );
        if (activeLive && activeLive.id !== streamId) {
          setStreamId(activeLive.id);
          return;
        }
      }
      setMessages(data.messages || []);
      setSurges(data.surges || []);
      setTopKeywords(data.topKeywords || []);
      setVelocity(data.velocityHistory || []);
      setBuffer(data.buffer || null);
      setMultiplierThreshold(data.spikeMultiplierThreshold || 2.6);
    } finally {
      setLoading(false);
    }
  }, [streamId]);

  useEffect(() => {
    setLoading(true);
    void loadChat();
  }, [loadChat]);

  useEffect(() => {
    return subscribeWs((event, payload) => {
      if (event === "chat_message" && payload) {
        const msg = payload as ChatMessageRecord;
        if (msg.streamId === streamId) {
          setMessages((prev) => [...prev.slice(-79), msg]);
          if (msg.matchedKeywords.length > 0) {
            setTopKeywords((prev) => {
              const map = new Map(prev.map((p) => [p.keyword, p.count]));
              msg.matchedKeywords.forEach((k) =>
                map.set(k, (map.get(k) || 0) + 1)
              );
              return Array.from(map.entries())
                .map(([keyword, count]) => ({ keyword, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 8);
            });
          }
        }
      } else if (event === "buffer_tick" && payload) {
        const b = payload as LiveBufferState;
        if (b.streamId === streamId) {
          setBuffer(b);
          setVelocity((prev) => [
            ...prev.slice(-21),
            {
              time: new Date().toTimeString().slice(0, 8),
              ratePerMin: b.chatRatePerMin,
              baseline: b.baselineChatRatePerMin,
              isSpike: b.chatMultiplier >= multiplierThreshold,
            },
          ]);
        }
      } else if (event === "chat_surge" && payload) {
        const s = payload as ChatSurgeRecord;
        if (s.streamId === streamId) {
          setSurges((prev) => [s, ...prev.slice(0, 14)]);
        }
      } else if (event === "stream_updated" && payload) {
        const st = payload as StreamRecord;
        setStreams((prev) => prev.map((x) => (x.id === st.id ? st : x)));
      }
    });
  }, [multiplierThreshold, streamId, subscribeWs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length]);

  const currentStream = streams.find((s) => s.id === streamId) || streams[0];

  async function sendDemoMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!testInput.trim()) return;
    const text = testInput.trim();
    setTestInput("");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ streamId, mode: "message", message: text }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      notify({
        type: "error",
        title: "Chat error",
        description: d.error || "Unable to send message.",
      });
    }
  }

  async function triggerChatSpike(andClip: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          streamId,
          mode: andClip ? "burst_and_clip" : "burst",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to trigger chat burst.");
      if (!andClip) {
        notify({
          type: "info",
          title: "Chat Surge Injected (Demo)",
          description: `Added ${data.added} hype messages to evaluate velocity detector.`,
        });
      }
      await loadChat();
    } catch (err) {
      notify({
        type: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : "Error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function startDemoFeed() {
    setBusy(true);
    try {
      const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      if (res.ok) await loadChat();
    } finally {
      setBusy(false);
    }
  }

  const maxVel = Math.max(
    120,
    ...velocity.map((v) => v.ratePerMin),
    Math.round((velocity[0]?.baseline || 30) * multiplierThreshold + 20)
  );
  const spikeLineRate = Math.round(
    (buffer?.baselineChatRatePerMin || velocity[0]?.baseline || 28) *
      multiplierThreshold
  );

  return (
    <StudioShell
      title="Chat Activity"
      subtitle="Real-time WebSocket chat monitoring, sudden message velocity surge detection, and trigger signals"
      actions={
        <select
          value={streamId}
          onChange={(e) => setStreamId(e.target.value)}
          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 focus:border-blue-600 focus:outline-none"
        >
          {streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.isDemo ? "[DEMO] " : "[LIVE] "}
              {s.channelName} ({platformLabel(s.platform)})
            </option>
          ))}
        </select>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-24 text-sm text-zinc-500 gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Loading real-time chat monitor...
        </div>
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Stream Status Banner */}
          {currentStream && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-subtle flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <SourceBadge isDemo={currentStream.isDemo} />
                <StreamStatusBadge
                  status={currentStream.status}
                  isDemo={currentStream.isDemo}
                />
                <span className="text-xs font-semibold text-zinc-800">
                  {currentStream.channelName}
                </span>
                <span className="text-xs text-zinc-500">
                  · Surge trigger at{" "}
                  <strong className="font-mono text-zinc-900">
                    {multiplierThreshold}x
                  </strong>{" "}
                  baseline ({spikeLineRate} msg/min)
                </span>
              </div>

              {currentStream.isDemo && (
                <div className="flex flex-wrap items-center gap-2">
                  {currentStream.status !== "monitoring" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void startDemoFeed()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                    >
                      <Play className="h-3 w-3 fill-zinc-800" />
                      Start Live Chat Stream
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void triggerChatSpike(false)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 transition"
                  >
                    <Flame className="h-3.5 w-3.5 text-amber-600" />
                    Test Chat Burst
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void triggerChatSpike(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Surge + Auto-Generate Clip
                  </button>
                </div>
              )}

              {!currentStream.isDemo && (
                <div className="flex flex-wrap items-center gap-2">
                  {buffer?.liveChatConnected && (
                    <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                      {buffer.liveChatSource || "Live Chat Connected"} (No API Key)
                    </span>
                  )}
                  {currentStream.status === "ready" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await fetch(
                            `/api/streams/${encodeURIComponent(currentStream.id)}`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "start" }),
                            }
                          );
                          await loadChat();
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 transition"
                    >
                      <Play className="h-3 w-3 fill-white" />
                      Connect Live Chat & 20s Buffer
                    </button>
                  )}
                  {currentStream.status === "monitoring" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          const res = await fetch(
                            `/api/streams/${encodeURIComponent(
                              currentStream.id
                            )}/trigger`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                scenario: "manual",
                                bypassCooldown: true,
                              }),
                            }
                          );
                          const data = await res.json();
                          if (!res.ok)
                            throw new Error(data.error || "Capture failed");
                          notify({
                            type: "success",
                            title: "Live Clip Saved!",
                            description: data.message,
                          });
                        } catch (err) {
                          notify({
                            type: "error",
                            title: "Capture Error",
                            description:
                              err instanceof Error ? err.message : "Error",
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      Clip Last 20s Live Now
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Main Grid: Velocity Chart + Surges (Left 7) | Live Chat Feed (Right 5) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 space-y-6">
              {/* Velocity Bar Chart */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <h2 className="text-sm font-extrabold text-zinc-950">
                        Chat Message Velocity (msg/min)
                      </h2>
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Blue bars indicate sudden surges exceeding {multiplierThreshold}x
                      the rolling baseline
                    </p>
                  </div>
                  {buffer && currentStream?.isDemo && (
                    <div className="text-right">
                      <span className="font-mono text-xl font-extrabold text-zinc-950">
                        {buffer.chatRatePerMin}
                      </span>
                      <span className="block text-[10px] font-mono text-zinc-500">
                        msg/min ({buffer.chatMultiplier}x)
                      </span>
                    </div>
                  )}
                </div>

                {velocity.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50 py-14 px-4 text-center text-xs text-zinc-500">
                    No live chat messages received for this source. Connect official
                    Twitch EventSub / YouTube LiveChat API credentials in Settings
                    to track live external chat velocity.
                  </div>
                ) : (
                  <div className="relative h-48 pt-4 pb-6 px-2 rounded-xl bg-zinc-50/70 border border-zinc-100">
                    {/* Threshold dashed horizontal line */}
                    <div
                      className="pointer-events-none absolute left-2 right-2 border-t border-dashed border-blue-400 flex justify-end"
                      style={{
                        bottom: `${Math.min(
                          88,
                          Math.max(15, (spikeLineRate / maxVel) * 78 + 12)
                        )}%`,
                      }}
                    >
                      <span className="-mt-4 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono font-bold text-blue-700">
                        Spike threshold ({spikeLineRate}/m)
                      </span>
                    </div>

                    <div className="h-full flex items-end gap-1.5">
                      {velocity.map((pt, idx) => {
                        const heightPct = Math.max(
                          6,
                          Math.min(100, Math.round((pt.ratePerMin / maxVel) * 100))
                        );
                        return (
                          <div
                            key={`${pt.time}-${idx}`}
                            className="flex-1 h-full flex flex-col justify-end group relative"
                            title={`${pt.time}: ${pt.ratePerMin} msg/min (baseline ${pt.baseline})`}
                          >
                            <div
                              className={`w-full rounded-t-md transition-all duration-300 ${
                                pt.isSpike
                                  ? "bg-blue-600 shadow-sm"
                                  : "bg-zinc-300 group-hover:bg-zinc-400"
                              }`}
                              style={{ height: `${heightPct}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Top Hype Signal Keywords */}
                {topKeywords.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-100">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-2">
                      Top Detected Hype Signals
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {topKeywords.map((kw) => (
                        <span
                          key={kw.keyword}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200/80 px-2.5 py-1 text-xs font-semibold text-blue-800"
                        >
                          <span>{kw.keyword}</span>
                          <span className="font-mono text-[10px] text-blue-600">
                            ×{kw.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Detected Chat Surges Log */}
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-card">
                <h2 className="text-sm font-extrabold text-zinc-950 mb-3">
                  Detected Chat Surge Events ({surges.length})
                </h2>
                {surges.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-6 text-center">
                    No chat velocity spikes logged for this stream yet.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {surges.map((s) => (
                      <div
                        key={s.id}
                        className="rounded-xl border border-zinc-200/90 p-3.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-extrabold text-blue-700 bg-blue-50 rounded-md px-2 py-0.5">
                              {s.multiplier}x Surge ({s.peakRatePerMin}/m)
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                s.outcome === "clip_generated"
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-zinc-100 text-zinc-700"
                              }`}
                            >
                              {s.outcome === "clip_generated"
                                ? "Clip Generated"
                                : "Duplicate Prevented"}
                            </span>
                            <span className="text-[11px] text-zinc-400">
                              {formatRelativeTime(s.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-zinc-600">
                            {s.outcomeNote}
                          </p>
                          {s.topKeywords.length > 0 && (
                            <p className="mt-1 text-[11px] font-mono text-zinc-400">
                              Keywords: {s.topKeywords.join(" · ")}
                            </p>
                          )}
                        </div>
                        {s.clipId && (
                          <Link
                            href={`/editor?clip=${encodeURIComponent(
                              s.clipId
                            )}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 transition shrink-0"
                          >
                            Open Clip
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Live Chat Stream Column */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-zinc-200 bg-white shadow-card flex flex-col h-[620px]">
                <div className="px-4 py-3.5 border-b border-zinc-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-blue-600" />
                    <h2 className="text-sm font-extrabold text-zinc-950">
                      Live Chat Feed
                    </h2>
                  </div>
                  {currentStream && (
                    <SourceBadge isDemo={currentStream.isDemo} size="xs" />
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                  {messages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-center text-xs text-zinc-500 px-6">
                      No chat messages for this stream. CLIPX AI never fabricates
                      chat messages for unconnected or video-only streams.
                    </div>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={`rounded-xl px-3 py-2 text-xs transition ${
                          m.isSpike
                            ? "bg-blue-50/80 border border-blue-200/80"
                            : "bg-zinc-50/70"
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold text-zinc-900">
                            {m.author}
                          </span>
                          {m.excitementScore >= 25 && (
                            <span className="font-mono text-[10px] font-bold text-blue-600 shrink-0">
                              +{m.excitementScore} hype
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-zinc-700 break-words">
                          {m.message}
                        </p>
                      </div>
                    ))
                  )}
                  <div ref={chatEndRef} />
                </div>

                {currentStream?.isDemo && (
                  <form
                    onSubmit={sendDemoMessage}
                    className="border-t border-zinc-100 p-3 flex items-center gap-2"
                  >
                    <input
                      type="text"
                      value={testInput}
                      onChange={(e) => setTestInput(e.target.value)}
                      placeholder="Type a hype test message (e.g. CLIP IT 1V5 ACE!!)"
                      className="flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-xl bg-zinc-950 p-2.5 text-white hover:bg-zinc-800 transition"
                      aria-label="Send demo test chat message"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </StudioShell>
  );
}
