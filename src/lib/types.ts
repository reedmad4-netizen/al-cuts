export type AspectRatio = "16:9" | "9:16" | "1:1";
export type VideoQuality = "1080p_source" | "1080p_high" | "720p_balanced";
export type ShortsLayout = "fit_blur" | "split_cam" | "zoom_crop";
export type StreamPlatform = "twitch" | "youtube" | "kick" | "hls" | "upload" | "demo";
export type StreamStatus =
  | "monitoring"
  | "ready"
  | "offline"
  | "credentials_required"
  | "error";
export type ClipStatus =
  | "buffering"
  | "capturing"
  | "encoding"
  | "scoring"
  | "ready"
  | "failed";

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  bio: string;
  avatarColor: string;
  isDemoAccount: boolean;
  createdAt: string;
}

export interface UserSettings {
  userId: string;
  preBufferSeconds: number; // Fixed 20s rolling pre-event buffer
  postBufferSeconds: number;
  minAiScore: number;
  hypeThreshold: number; // 30..95 live hype index trigger for hands-free capture
  dedupeCooldownSeconds: number;
  chatSpikeMultiplier: number;
  defaultAspectRatio: AspectRatio;
  videoQuality: VideoQuality; // 1080p_source (lossless 1080p60 + 1080x1920 Short) | 1080p_high | 720p_balanced
  shortsLayout: ShortsLayout; // fit_blur (full 16:9 frame inside 9:16) | split_cam | zoom_crop
  autoShortsEnabled: boolean; // Auto-generate 9:16 Short while keeping 16:9 Original
  autoShortsCaption: boolean; // Burn smart caption + timed subtitles onto auto 9:16 Short
  autoDownloadEnabled: boolean; // Auto-download & save BOTH Original + 9:16 Short (warns on music)
  musicDetectionEnabled: boolean;
  warnBeforeCopyrightExport: boolean;
  showDemoData: boolean;
  twitchConfigured: boolean;
  twitchClientId: string;
  youtubeConfigured: boolean;
  kickConfigured: boolean;
  supabaseConfigured: boolean;
  updatedAt: string;
}

export interface StreamRecord {
  id: string;
  userId: string | null;
  title: string;
  channelName: string;
  gameName: string;
  platform: StreamPlatform;
  streamUrl: string;
  localSourcePath: string | null;
  previewVideoUrl: string | null;
  status: StreamStatus;
  statusReason: string;
  isDemo: boolean;
  isAuthorized: boolean;
  viewerCount: number;
  preBufferSeconds: number;
  postBufferSeconds: number;
  minAiScore: number;
  hypeThreshold: number;
  videoQuality: VideoQuality;
  shortsLayout: ShortsLayout;
  autoShortsEnabled: boolean;
  autoDownloadEnabled: boolean;
  dedupeCooldownSeconds: number;
  lastClipEventAt: string | null;
  createdAt: string;
}

export interface CaptionConfig {
  text: string;
  position: "top" | "center" | "bottom";
  style: "pill" | "bold" | "blue";
  fontSize: "sm" | "md" | "lg";
}

export interface SubtitleCue {
  id: string;
  startTime: number; // seconds relative to clip start
  endTime: number;
  text: string;
}

export interface ScoreBreakdown {
  total: number;
  chatActivity: number;
  gameplayMoments: number;
  suddenReactions: number;
  inGameEvents: number;
  viewerEngagement: number;
}

export interface MusicAnalysis {
  flagged: boolean;
  confidence: number;
  trackMatch: string;
  details: string;
  rmsDb: number;
  crestFactor: number;
  audioModified: boolean;
}

export interface ClipRecord {
  id: string;
  userId: string | null;
  streamId: string | null;
  parentClipId: string | null;
  title: string;
  gameName: string;
  channelName: string;
  platform: StreamPlatform;
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  preBufferSeconds: number;
  postBufferSeconds: number;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fileSizeBytes: number;
  status: ClipStatus;
  errorMessage: string | null;
  aiScore: number;
  scores: ScoreBreakdown;
  triggerReason: string;
  aiSummary: string;
  music: MusicAnalysis;
  caption: CaptionConfig | null;
  subtitles: SubtitleCue[];
  isEdited: boolean;
  isDemo: boolean;
  ownerAuthorized: boolean;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  streamId: string;
  author: string;
  message: string;
  excitementScore: number;
  matchedKeywords: string[];
  isSpike: boolean;
  isDemo: boolean;
  createdAt: string;
}

export interface ChatSurgeRecord {
  id: string;
  streamId: string;
  clipId: string | null;
  channelName: string;
  peakRatePerMin: number;
  baselineRatePerMin: number;
  multiplier: number;
  topKeywords: string[];
  outcome: "clip_generated" | "duplicate_suppressed" | "below_threshold";
  outcomeNote: string;
  isDemo: boolean;
  createdAt: string;
}

export interface DownloadRecord {
  id: string;
  clipId: string;
  userId: string | null;
  clipTitle: string;
  format: string;
  aspectRatio: AspectRatio;
  fileSizeBytes: number;
  copyrightAcknowledged: boolean;
  savedExportPath: string;
  isDemo: boolean;
  downloadedAt: string;
}

export interface BufferSegment {
  index: number;
  startSec: number;
  endSec: number;
  excitement: number;
  filled: boolean;
}

export interface LiveBufferState {
  streamId: string;
  isDemo: boolean;
  active: boolean;
  bufferDurationSec: number;
  targetBufferSec: number;
  postBufferSec: number;
  currentStreamTimeSec: number;
  chatRatePerMin: number;
  baselineChatRatePerMin: number;
  chatMultiplier: number;
  videoMotionScore: number;
  audioPeakDb: number;
  combinedExcitement: number;
  threshold: number;
  hypeThreshold: number;
  autoShortsEnabled: boolean;
  autoDownloadEnabled: boolean;
  cooldownRemainingSec: number;
  captureState: "idle" | "buffering" | "capturing_post" | "encoding" | "scoring";
  liveChatConnected?: boolean;
  liveChatSource?: string;
  segments: BufferSegment[];
  updatedAt: string;
}

export interface AutoDownloadBundleEvent {
  bundleId: string;
  status: "ready" | "copyright_hold";
  streamId: string;
  channelName: string;
  triggerType: "hype_auto" | "manual";
  hypeScore: number;
  originalClip: ClipRecord;
  shortClip: ClipRecord | null;
  exportFiles: string[];
}

export interface DiscoveredLiveStream {
  platform: "twitch" | "youtube";
  channelId: string;
  channelName: string;
  title: string;
  gameName: string;
  viewerCount: number;
  thumbnailUrl: string;
  streamUrl: string;
}

export interface ProcessingJob {
  id: string;
  clipId?: string;
  streamId?: string;
  title: string;
  type: "auto_capture" | "video_edit" | "source_scan" | "music_scan";
  stage: string;
  progress: number;
  status: "running" | "completed" | "failed";
  isDemo: boolean;
  error?: string;
  updatedAt: string;
}
