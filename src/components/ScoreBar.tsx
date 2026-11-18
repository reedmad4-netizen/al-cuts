import React from "react";
import type { ScoreBreakdown } from "@/lib/types";

export function ScoreBar({
  score,
  compact = false,
  showLabel = true,
}: {
  score: number;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const tier =
    clamped >= 90
      ? "Viral"
      : clamped >= 80
      ? "High"
      : clamped >= 65
      ? "Good"
      : "Standard";

  const barColor =
    clamped >= 85
      ? "bg-blue-600"
      : clamped >= 70
      ? "bg-blue-500"
      : "bg-zinc-500";

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold text-zinc-700 flex items-center gap-1.5">
            AI Score
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                clamped >= 80
                  ? "bg-blue-50 text-blue-700"
                  : "bg-zinc-100 text-zinc-600"
              }`}
            >
              {tier}
            </span>
          </span>
          <span className="font-mono font-bold text-zinc-950">
            {clamped}
            <span className="text-zinc-400 font-normal">/100</span>
          </span>
        </div>
      )}
      <div
        className={`w-full overflow-hidden rounded-full bg-zinc-100 ${
          compact ? "h-1.5" : "h-2"
        }`}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`${barColor} h-full rounded-full transition-all duration-500 ease-out`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreBreakdownPanel({
  scores,
  summary,
}: {
  scores: ScoreBreakdown;
  summary?: string;
}) {
  const rows = [
    { label: "Chat Activity", value: scores.chatActivity },
    { label: "Exciting Gameplay", value: scores.gameplayMoments },
    { label: "Sudden Reactions", value: scores.suddenReactions },
    { label: "In-Game Events", value: scores.inGameEvents },
    { label: "Viewer Engagement", value: scores.viewerEngagement },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-zinc-100 pb-2.5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Composite AI Clip Score
          </p>
          <p className="text-2xl font-extrabold tracking-tight text-zinc-950 mt-0.5">
            {scores.total}
            <span className="text-sm font-medium text-zinc-400"> / 100</span>
          </p>
        </div>
        <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-bold text-blue-700">
          5-Signal Model
        </span>
      </div>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-zinc-700">{r.label}</span>
              <span className="font-mono font-semibold text-zinc-900">
                {r.value}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-zinc-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-500"
                style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {summary && (
        <p className="rounded-xl bg-zinc-50 border border-zinc-200/80 p-3 text-xs text-zinc-600 leading-relaxed">
          {summary}
        </p>
      )}
    </div>
  );
}
