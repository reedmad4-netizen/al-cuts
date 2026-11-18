import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  KeyRound,
  Radio,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import type { MusicAnalysis, StreamStatus } from "@/lib/types";

export function SourceBadge({
  isDemo,
  size = "sm",
}: {
  isDemo: boolean;
  size?: "xs" | "sm";
}) {
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]";
  if (isDemo) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 font-semibold text-amber-800 ${pad}`}
        title="Sample demo data — not recorded from a live external broadcast"
      >
        <FlaskConical className="h-3 w-3 text-amber-600" />
        DEMO
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 font-semibold text-emerald-800 ${pad}`}
      title="Real live stream or uploaded gameplay footage (not demo sample data)"
    >
      <ShieldCheck className="h-3 w-3 text-emerald-600" />
      LIVE
    </span>
  );
}

export function StreamStatusBadge({
  status,
  isDemo,
}: {
  status: StreamStatus;
  isDemo: boolean;
}) {
  if (status === "monitoring") {
    return isDemo ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
        Simulating Buffer (Demo)
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
        Monitoring Live
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-xs font-semibold text-zinc-700">
        <Radio className="h-3 w-3 text-zinc-500" />
        {isDemo ? "Sandbox Idle" : "Verified · Ready"}
      </span>
    );
  }
  if (status === "credentials_required") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        <KeyRound className="h-3 w-3 text-amber-600" />
        Not Connected · API Key Needed
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-semibold text-rose-700">
        <AlertTriangle className="h-3 w-3 text-rose-600" />
        Unreachable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 border border-zinc-200 px-2.5 py-0.5 text-xs font-semibold text-zinc-600">
      <WifiOff className="h-3 w-3 text-zinc-400" />
      Offline
    </span>
  );
}

export function MusicBadge({
  music,
  compact = false,
}: {
  music: MusicAnalysis;
  compact?: boolean;
}) {
  if (music.flagged) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
        title={music.details}
      >
        <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
        {compact ? "Music Flag" : `Music Flag (${music.confidence}%)`}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-zinc-50 border border-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600"
      title={music.details}
    >
      <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
      {compact ? "Clean" : "Clean Audio"}
    </span>
  );
}
