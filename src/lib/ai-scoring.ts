import type { ScoreBreakdown, SubtitleCue } from "./types";

const HYPE_LEXICON: Record<string, number> = {
  "clip it": 28,
  "clip that": 28,
  ace: 26,
  "1v5": 30,
  "1v4": 26,
  clutch: 25,
  "no way": 22,
  insane: 22,
  omg: 18,
  what: 12,
  crazy: 18,
  goat: 20,
  record: 24,
  "world record": 30,
  parry: 22,
  godlike: 25,
  wipe: 22,
  champion: 24,
  letsss: 18,
  "lets go": 20,
  "let's go": 20,
  pog: 18,
  poggers: 20,
  holy: 18,
  w: 10,
  gg: 10,
  headshot: 22,
  overtime: 20,
  nasty: 18,
  clean: 14,
};

export function analyzeChatMessage(text: string): {
  excitementScore: number;
  matchedKeywords: string[];
  isSpikeCandidate: boolean;
} {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let score = 0;

  for (const [phrase, weight] of Object.entries(HYPE_LEXICON)) {
    if (phrase.length <= 2) {
      const tokens = lower.split(/\s+/);
      if (tokens.includes(phrase)) {
        matched.push(phrase.toUpperCase());
        score += weight;
      }
    } else if (lower.includes(phrase)) {
      matched.push(phrase.toUpperCase());
      score += weight;
    }
  }

  // All-caps and exclamation intensity signal
  const letters = text.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 4) {
    const upperRatio =
      text.replace(/[^A-Z]/g, "").length / Math.max(1, letters.length);
    if (upperRatio > 0.7) score += 16;
  }
  const bangs = (text.match(/!/g) || []).length;
  score += Math.min(18, bangs * 6);

  const clamped = Math.min(100, Math.round(score));
  return {
    excitementScore: clamped,
    matchedKeywords: Array.from(new Set(matched)).slice(0, 4),
    isSpikeCandidate: clamped >= 32,
  };
}

export interface ScoringSignals {
  chatRatePerMin: number;
  baselineChatRatePerMin: number;
  hypeKeywordDensity: number; // 0..1
  videoMotionIntensity: number; // 0..100
  audioPeakDeltaDb: number; // dB rise above baseline (0..35)
  eventTier:
    | "clutch_ace"
    | "victory_wipe"
    | "record_finish"
    | "boss_parry"
    | "multi_kill"
    | "audio_motion_peak"
    | "manual_buffer";
  viewerRetentionRatio: number; // 0.5..2.0
  triggerLabel?: string;
}

const EVENT_TIER_SCORES: Record<ScoringSignals["eventTier"], number> = {
  clutch_ace: 97,
  victory_wipe: 92,
  record_finish: 88,
  boss_parry: 90,
  multi_kill: 82,
  audio_motion_peak: 78,
  manual_buffer: 68,
};

export function computeAiClipScore(signals: ScoringSignals): {
  scores: ScoreBreakdown;
  summary: string;
} {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  const multiplier =
    signals.chatRatePerMin / Math.max(8, signals.baselineChatRatePerMin);

  // 1. Chat activity (0-100)
  const chatActivity =
    signals.chatRatePerMin <= 0
      ? 52 // Authorized video-only source: neutral baseline from video signals
      : clamp(
          Math.min(72, multiplier * 16.5) + signals.hypeKeywordDensity * 32
        );

  // 2. Exciting gameplay moments (0-100)
  const gameplayMoments = clamp(signals.videoMotionIntensity);

  // 3. Sudden reactions — audio transient jump + immediate chat velocity burst (0-100)
  const suddenReactions = clamp(
    34 + signals.audioPeakDeltaDb * 2.1 + Math.min(20, (multiplier - 1) * 5)
  );

  // 4. Important in-game events (0-100)
  const inGameEvents = clamp(EVENT_TIER_SCORES[signals.eventTier] ?? 75);

  // 5. Viewer engagement signals (0-100)
  const viewerEngagement = clamp(
    42 +
      (signals.viewerRetentionRatio - 0.6) * 38 +
      signals.hypeKeywordDensity * 18
  );

  // Weighted composite AI score (0-100)
  const hasLiveChat = signals.chatRatePerMin > 0;
  const weighted = hasLiveChat
    ? chatActivity * 0.24 +
      gameplayMoments * 0.24 +
      suddenReactions * 0.18 +
      inGameEvents * 0.20 +
      viewerEngagement * 0.14
    : gameplayMoments * 0.34 +
      suddenReactions * 0.30 +
      inGameEvents * 0.24 +
      viewerEngagement * 0.12;

  const total = clamp(weighted);

  const tierWord =
    total >= 90
      ? "Viral-tier highlight"
      : total >= 80
      ? "High-impact gaming moment"
      : total >= 65
      ? "Strong clip candidate"
      : "Moderate gameplay moment";

  const chatNote = hasLiveChat
    ? `chat surged ${multiplier.toFixed(1)}x above baseline (${Math.round(
        signals.chatRatePerMin
      )} msg/min)`
    : "detected directly from high-energy video motion and audio peak telemetry";

  const summary = `${tierWord} (${total}/100): ${
    signals.triggerLabel || "Exciting gameplay sequence"
  } — ${chatNote}, paired with +${signals.audioPeakDeltaDb.toFixed(
    1
  )} dB reaction peak and ${gameplayMoments}% combat/motion intensity.`;

  return {
    scores: {
      total,
      chatActivity,
      gameplayMoments,
      suddenReactions,
      inGameEvents,
      viewerEngagement,
    },
    summary,
  };
}

/**
 * Duplicate Clip Suppression:
 * Rejects events that overlap the active capture window or fall within the
 * configured post-event cooldown window.
 */
export function checkDuplicateSuppression(params: {
  lastClipEventAtIso: string | null;
  nowMs?: number;
  cooldownSeconds: number;
  isCurrentlyCapturing: boolean;
}): { isDuplicate: boolean; reason: string; remainingSec: number } {
  const now = params.nowMs ?? Date.now();
  if (params.isCurrentlyCapturing) {
    return {
      isDuplicate: true,
      reason:
        "Overlaps an active 20s pre-buffer + post-event capture already in progress.",
      remainingSec: params.cooldownSeconds,
    };
  }
  if (!params.lastClipEventAtIso) {
    return { isDuplicate: false, reason: "", remainingSec: 0 };
  }
  const lastMs = new Date(params.lastClipEventAtIso).getTime();
  if (Number.isNaN(lastMs)) {
    return { isDuplicate: false, reason: "", remainingSec: 0 };
  }
  const elapsedSec = (now - lastMs) / 1000;
  if (elapsedSec < params.cooldownSeconds) {
    const remaining = Math.max(1, Math.ceil(params.cooldownSeconds - elapsedSec));
    return {
      isDuplicate: true,
      reason: `Suppressed duplicate clip — event occurred ${elapsedSec.toFixed(
        1
      )}s after previous clip (cooldown ${params.cooldownSeconds}s, ${remaining}s left).`,
      remainingSec: remaining,
    };
  }
  return { isDuplicate: false, reason: "", remainingSec: 0 };
}

/**
 * Generates contextual timed subtitle cues synchronized to the 20s pre-buffer
 * and post-event highlight moment for the Video Editor.
 */
export function generateSmartSubtitles(params: {
  durationSeconds: number;
  preBufferSeconds: number;
  gameName: string;
  triggerReason: string;
}): SubtitleCue[] {
  const dur = Math.max(4, params.durationSeconds);
  const peak = Math.min(dur - 2.5, Math.max(2, params.preBufferSeconds - 0.5));

  if (dur <= 10) {
    return [
      {
        id: `sub-1`,
        startTime: 0.4,
        endTime: Number(Math.min(dur * 0.48, dur - 1).toFixed(1)),
        text: "Wait for this play right here...",
      },
      {
        id: `sub-2`,
        startTime: Number(Math.min(dur * 0.5, dur - 0.8).toFixed(1)),
        endTime: Number(Math.max(1.2, dur - 0.3).toFixed(1)),
        text: `NO WAY! ${params.triggerReason.slice(0, 42)}!`,
      },
    ];
  }

  const cues: SubtitleCue[] = [
    {
      id: `sub-1`,
      startTime: 0.6,
      endTime: Number(Math.min(peak - 6.5, 4.8).toFixed(1)),
      text: `${params.gameName} live — watch this entire sequence.`,
    },
    {
      id: `sub-2`,
      startTime: Number(Math.max(5.2, peak - 6.0).toFixed(1)),
      endTime: Number(Math.max(7.5, peak - 1.0).toFixed(1)),
      text: "Wait, watch the timing on this play...",
    },
    {
      id: `sub-3`,
      startTime: Number(peak.toFixed(1)),
      endTime: Number(Math.min(dur - 0.4, peak + 4.0).toFixed(1)),
      text: "OH MY GOD! CLIP THAT RIGHT NOW!",
    },
  ];

  if (peak + 4.4 < dur - 1.0) {
    cues.push({
      id: `sub-4`,
      startTime: Number((peak + 4.3).toFixed(1)),
      endTime: Number(Math.min(dur - 0.4, peak + 10.5).toFixed(1)),
      text: "Chat is going absolutely crazy — let's go!",
    });
  }

  if (peak + 11.2 < dur - 1.5) {
    cues.push({
      id: `sub-5`,
      startTime: Number((peak + 11.0).toFixed(1)),
      endTime: Number(Math.min(dur - 0.4, dur - 0.5).toFixed(1)),
      text: "Full aftermath reaction — instant highlight!",
    });
  }

  return cues.filter((c) => c.endTime - c.startTime >= 0.8);
}
