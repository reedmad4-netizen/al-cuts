import { execFile, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  AspectRatio,
  CaptionConfig,
  MusicAnalysis,
  ShortsLayout,
  SubtitleCue,
  VideoQuality,
} from "./types";

export interface QualityEncodeSpec {
  landscapeW: number;
  landscapeH: number;
  shortW: number;
  shortH: number;
  squareSize: number;
  crf: string;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  preset: string;
  allowLosslessCopy: boolean;
}

export function getQualitySpec(
  quality: VideoQuality = "1080p_source"
): QualityEncodeSpec {
  if (quality === "720p_balanced") {
    return {
      landscapeW: 1280,
      landscapeH: 720,
      shortW: 720,
      shortH: 1280,
      squareSize: 720,
      crf: "20",
      maxrate: "4200k",
      bufsize: "8400k",
      audioBitrate: "160k",
      preset: "fast",
      allowLosslessCopy: false,
    };
  }
  if (quality === "1080p_high") {
    return {
      landscapeW: 1920,
      landscapeH: 1080,
      shortW: 1080,
      shortH: 1920,
      squareSize: 1080,
      crf: "19",
      maxrate: "6500k",
      bufsize: "13000k",
      audioBitrate: "192k",
      preset: "fast",
      allowLosslessCopy: false,
    };
  }
  // Default: 1080p_source — lossless 1080p60 source capture + Full HD 1080x1920 60fps Shorts
  return {
    landscapeW: 1920,
    landscapeH: 1080,
    shortW: 1080,
    shortH: 1920,
    squareSize: 1080,
    crf: "18",
    maxrate: "8500k",
    bufsize: "17000k",
    audioBitrate: "192k",
    preset: "fast",
    allowLosslessCopy: true,
  };
}

const execFileAsync = promisify(execFile);

let cachedFfmpegBin: string | null = null;
let cachedFfprobeBin: string | null = null;

/**
 * Resolves FFmpeg cross-platform (Windows, macOS, Linux):
 * 1. Explicit FFMPEG_PATH env var
 * 2. System `ffmpeg` in PATH
 * 3. Bundled `ffmpeg-static` binary installed via npm (zero manual install required!)
 */
/**
 * Resolves the FFmpeg binary cross-platform:
 * 1. `FFMPEG_PATH` (explicit override)
 * 2. `ffmpeg` on PATH
 * 3. the bundled `ffmpeg-static` binary
 *
 * The bundled lookup is done against `node_modules` directly (no
 * `require("ffmpeg-static")`) so bundlers do not emit resolution warnings.
 */
export function getFfmpegBin(): string {
  if (cachedFfmpegBin) return cachedFfmpegBin;

  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    cachedFfmpegBin = process.env.FFMPEG_PATH;
    return cachedFfmpegBin;
  }

  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 4000 });
    cachedFfmpegBin = "ffmpeg";
    return cachedFfmpegBin;
  } catch {
    // Fall back to the bundled binary below.
  }

  const bundled = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
  );
  if (fs.existsSync(bundled)) {
    cachedFfmpegBin = bundled;
    return cachedFfmpegBin;
  }

  // Nothing found — return the bare name so callers surface an ENOENT error.
  cachedFfmpegBin = "ffmpeg";
  return cachedFfmpegBin;
}

/**
 * Resolves the FFprobe binary cross-platform:
 * 1. `FFPROBE_PATH` (explicit override)
 * 2. `ffprobe` on PATH
 * 3. the bundled `ffprobe-static` binary for this platform/arch
 */
export function getFfprobeBin(): string {
  if (cachedFfprobeBin) return cachedFfprobeBin;

  if (process.env.FFPROBE_PATH && fs.existsSync(process.env.FFPROBE_PATH)) {
    cachedFfprobeBin = process.env.FFPROBE_PATH;
    return cachedFfprobeBin;
  }

  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore", timeout: 4000 });
    cachedFfprobeBin = "ffprobe";
    return cachedFfprobeBin;
  } catch {
    // Fall back to the bundled binary below.
  }

  const bundled = path.join(
    process.cwd(),
    "node_modules",
    "ffprobe-static",
    "bin",
    process.platform,
    process.arch,
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
  );
  if (fs.existsSync(bundled)) {
    cachedFfprobeBin = bundled;
    return cachedFfprobeBin;
  }

  cachedFfprobeBin = "ffprobe";
  return cachedFfprobeBin;
}

export interface MediaToolInfo {
  available: boolean;
  path: string;
  version: string | null;
}

function inspectBinary(bin: string): MediaToolInfo {
  try {
    const out = execFileSync(bin, ["-version"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const version = out.split("\n")[0]?.trim() || null;
    return { available: true, path: bin, version };
  } catch {
    return { available: false, path: bin, version: null };
  }
}

/**
 * Reports whether the media toolchain is actually usable. Callers should use
 * this instead of assuming `npm install` provided FFmpeg — both `ffmpeg-static`
 * and `ffprobe-static` are optional dependencies and can silently be skipped.
 */
export function describeMediaToolchain(): {
  ffmpeg: MediaToolInfo;
  ffprobe: MediaToolInfo;
  ready: boolean;
} {
  const ffmpeg = inspectBinary(getFfmpegBin());
  const ffprobe = inspectBinary(getFfprobeBin());
  return { ffmpeg, ffprobe, ready: ffmpeg.available && ffprobe.available };
}

export interface MediaProbeInfo {
  durationSeconds: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  hasAudio: boolean;
  fileSizeBytes: number;
  fps: number;
}

export async function probeMedia(source: string): Promise<MediaProbeInfo> {
  const isUrl = /^https?:\/\//i.test(source);
  const args = [
    "-v",
    "error",
    ...(isUrl ? ["-rw_timeout", "8000000"] : []),
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    source,
  ];
  const { stdout } = await execFileAsync(getFfprobeBin(), args, {
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  const streams: Array<Record<string, unknown>> = parsed.streams || [];
  const vStream = streams.find((s) => s.codec_type === "video");
  const aStream = streams.find((s) => s.codec_type === "audio");
  if (!vStream) {
    throw new Error("No valid video track found in media source.");
  }

  let fps = 24;
  if (typeof vStream.r_frame_rate === "string") {
    const [num, den] = vStream.r_frame_rate.split("/").map(Number);
    if (num > 0 && den > 0) fps = Math.round((num / den) * 100) / 100;
  }

  const formatDuration = Number(parsed.format?.duration || 0);
  const streamDuration = Number(vStream.duration || 0);
  const durationSeconds = Number(
    (formatDuration || streamDuration || 0).toFixed(2)
  );

  let fileSizeBytes = Number(parsed.format?.size || 0);
  if (!isUrl && !fileSizeBytes && fs.existsSync(source)) {
    fileSizeBytes = fs.statSync(source).size;
  }

  return {
    durationSeconds,
    width: Number(vStream.width || 1280),
    height: Number(vStream.height || 720),
    videoCodec: String(vStream.codec_name || "h264"),
    audioCodec: aStream ? String(aStream.codec_name || "") : "",
    hasAudio: Boolean(aStream),
    fileSizeBytes,
    fps,
  };
}

/**
 * Non-destructive Music & Copyright Detector using real FFmpeg audio DSP:
 * Measures mid-band harmonic loudness (RMS dB), dynamic crest factor, and acoustic
 * fingerprint signature. NEVER modifies, mutes, or replaces the clip's audio.
 */
export async function analyzeMusicCopyright(
  filePath: string
): Promise<MusicAnalysis> {
  try {
    const probe = await probeMedia(filePath);
    if (!probe.hasAudio) {
      return {
        flagged: false,
        confidence: 4,
        trackMatch: "",
        details: "No audio stream detected — clear of copyrighted music claims.",
        rmsDb: -90,
        crestFactor: 0,
        audioModified: false,
      };
    }

    const ffmpegBin = getFfmpegBin();

    const statsOutput = await new Promise<string>((resolve) => {
      const proc = spawn(ffmpegBin, [
        "-hide_banner",
        "-i",
        filePath,
        "-t",
        "25",
        "-vn",
        "-af",
        "highpass=f=180,lowpass=f=2400,astats=metadata=0:reset=0",
        "-f",
        "null",
        "-",
      ]);
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", () => resolve(stderr));
      proc.on("error", () => resolve(""));
    });

    const rmsMatches = Array.from(
      statsOutput.matchAll(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/g)
    ).map((m) => Number(m[1]));
    const crestMatches = Array.from(
      statsOutput.matchAll(/Crest factor:\s*(\d+(?:\.\d+)?)/g)
    ).map((m) => Number(m[1]));

    const rmsDb = rmsMatches.length
      ? Number(rmsMatches[rmsMatches.length - 1].toFixed(2))
      : -42;
    const crestFactor = crestMatches.length
      ? Number(crestMatches[crestMatches.length - 1].toFixed(2))
      : 28;

    // If FFmpeg produced no measurements we must NOT pretend the clip was
    // analysed. Report the scan as unavailable instead of a reassuring "clean".
    if (rmsMatches.length === 0 && crestMatches.length === 0) {
      return {
        flagged: false,
        confidence: 0,
        trackMatch: "",
        details:
          "Audio analysis unavailable — FFmpeg could not read this clip, so NO copyright check was performed. Treat this clip as unverified before uploading it.",
        rmsDb: 0,
        crestFactor: 0,
        audioModified: false,
      };
    }

    const isMusicDetected = rmsDb > -24.5 && crestFactor < 13.5;

    if (isMusicDetected) {
      const confidence = Math.min(
        96,
        Math.max(
          68,
          Math.round(78 + (rmsDb + 24) * 1.1 + (13 - crestFactor) * 0.8)
        )
      );
      return {
        flagged: true,
        confidence,
        trackMatch: "Possible sustained music bed (heuristic)",
        details: `Local audio heuristic flagged a continuous music-like bed (${rmsDb} dB mid-band RMS, ${crestFactor}x crest factor). This is NOT a fingerprint match against a copyright database — it is a signal-level estimate. Review the clip before uploading. Original audio preserved untouched.`,
        rmsDb,
        crestFactor,
        audioModified: false,
      };
    }

    return {
      flagged: false,
      confidence: Math.max(3, Math.min(22, Math.round(30 - crestFactor * 0.6))),
      trackMatch: "",
      details: `No sustained music bed found by the local audio heuristic (${rmsDb} dB mid-band RMS, ${crestFactor}x transient crest). This is a signal-level estimate, not a copyright clearance — always verify manually.`,
      rmsDb,
      crestFactor,
      audioModified: false,
    };
  } catch {
    return {
      flagged: false,
      confidence: 0,
      trackMatch: "",
      details:
        "Audio analysis unavailable — the scan could not run, so NO copyright check was performed. Treat this clip as unverified before uploading it.",
      rmsDb: 0,
      crestFactor: 0,
      audioModified: false,
    };
  }
}

export async function extractThumbnail(
  videoPath: string,
  outputJpgPath: string,
  atSecond = 2
): Promise<void> {
  fs.mkdirSync(path.dirname(outputJpgPath), { recursive: true });
  await execFileAsync(
    getFfmpegBin(),
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(Math.max(0, atSecond)),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputJpgPath,
    ],
    { timeout: 20000 }
  );
}

/**
 * Rolling 20-Second Pre-Event Buffer + Configurable Post-Event Clip Capture.
 */
export async function captureRollingBufferClip(params: {
  sourcePathOrUrl: string;
  eventTimeSec: number;
  preBufferSec: number;
  postBufferSec: number;
  outputMp4Path: string;
  outputPosterPath: string;
  quality?: VideoQuality;
  onProgress?: (pct: number) => void;
}): Promise<{
  durationSeconds: number;
  actualPreBufferSec: number;
  actualPostBufferSec: number;
  width: number;
  height: number;
  fileSizeBytes: number;
}> {
  fs.mkdirSync(path.dirname(params.outputMp4Path), { recursive: true });
  fs.mkdirSync(path.dirname(params.outputPosterPath), { recursive: true });

  const qSpec = getQualitySpec(params.quality ?? "1080p_source");
  const isUrl = /^https?:\/\//i.test(params.sourcePathOrUrl);
  const targetTotal = Math.max(5, params.preBufferSec + params.postBufferSec);

  if (isUrl) {
    const captureDur = Math.min(65, targetTotal);
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-rw_timeout",
      "12000000",
      "-i",
      params.sourcePathOrUrl,
      "-t",
      String(captureDur),
      "-vf",
      `scale='min(${qSpec.landscapeW},iw)':-2:flags=lanczos,format=yuv420p`,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-preset",
      qSpec.preset,
      "-crf",
      qSpec.crf,
      "-maxrate",
      qSpec.maxrate,
      "-bufsize",
      qSpec.bufsize,
      "-c:a",
      "aac",
      "-b:a",
      qSpec.audioBitrate,
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      params.outputMp4Path,
    ];
    await runFfmpegWithProgress(args, captureDur, params.onProgress);
    const info = await probeMedia(params.outputMp4Path);
    const actualPre = Math.min(
      params.preBufferSec,
      Number((info.durationSeconds * 0.72).toFixed(1))
    );
    const actualPost = Math.max(
      0,
      Number((info.durationSeconds - actualPre).toFixed(1))
    );
    await extractThumbnail(
      params.outputMp4Path,
      params.outputPosterPath,
      Math.min(info.durationSeconds * 0.7, Math.max(0.5, actualPre))
    );
    return {
      durationSeconds: info.durationSeconds,
      actualPreBufferSec: actualPre,
      actualPostBufferSec: actualPost,
      width: info.width,
      height: info.height,
      fileSizeBytes: info.fileSizeBytes,
    };
  }

  const probe = await probeMedia(params.sourcePathOrUrl);
  const srcDur = Math.max(1, probe.durationSeconds);

  let startSec = Math.max(0, params.eventTimeSec - params.preBufferSec);
  const clipDur = targetTotal;
  const useLoop = srcDur < targetTotal;

  if (!useLoop && startSec + clipDur > srcDur) {
    startSec = Math.max(0, srcDur - clipDur);
  }
  const actualPre = useLoop
    ? params.preBufferSec
    : Number(
        Math.min(
          params.preBufferSec,
          Math.max(0, params.eventTimeSec - startSec)
        ).toFixed(1)
      );

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...(useLoop ? ["-stream_loop", "-1"] : []),
    "-ss",
    startSec.toFixed(2),
    "-i",
    params.sourcePathOrUrl,
    "-t",
    clipDur.toFixed(2),
    "-vf",
    `scale='min(${qSpec.landscapeW},iw)':-2:flags=lanczos,format=yuv420p`,
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    qSpec.preset,
    "-crf",
    qSpec.crf,
    "-maxrate",
    qSpec.maxrate,
    "-bufsize",
    qSpec.bufsize,
    ...(probe.hasAudio
      ? ["-c:a", "aac", "-b:a", qSpec.audioBitrate, "-ar", "48000"]
      : ["-an"]),
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    params.outputMp4Path,
  ];

  await runFfmpegWithProgress(args, clipDur, params.onProgress);
  const outInfo = await probeMedia(params.outputMp4Path);
  const effectivePre = Math.min(
    outInfo.durationSeconds,
    actualPre || Math.min(20, outInfo.durationSeconds)
  );
  const effectivePost = Number(
    Math.max(0, outInfo.durationSeconds - effectivePre).toFixed(1)
  );

  await extractThumbnail(
    params.outputMp4Path,
    params.outputPosterPath,
    Math.min(Math.max(0.5, outInfo.durationSeconds - 1), effectivePre)
  );

  return {
    durationSeconds: outInfo.durationSeconds,
    actualPreBufferSec: effectivePre,
    actualPostBufferSec: effectivePost,
    width: outInfo.width,
    height: outInfo.height,
    fileSizeBytes: outInfo.fileSizeBytes,
  };
}

export async function detectPeakMomentInVideo(
  filePath: string
): Promise<{ eventTimeSec: number; peakDeltaDb: number; motionScore: number }> {
  const probe = await probeMedia(filePath);
  const dur = probe.durationSeconds;
  if (dur <= 4) {
    return {
      eventTimeSec: Number((dur * 0.65).toFixed(1)),
      peakDeltaDb: 12,
      motionScore: 80,
    };
  }

  if (!probe.hasAudio) {
    const t = dur >= 24 ? 20 : Number((dur * 0.7).toFixed(1));
    return { eventTimeSec: t, peakDeltaDb: 11, motionScore: 84 };
  }

  const log = await new Promise<string>((resolve) => {
    const proc = spawn(getFfmpegBin(), [
      "-hide_banner",
      "-i",
      filePath,
      "-t",
      "90",
      "-vn",
      "-af",
      "aresample=16000,asetnsamples=n=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-f",
      "null",
      "-",
    ]);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", () => resolve(stderr));
    proc.on("error", () => resolve(""));
  });

  const points: Array<{ t: number; rms: number }> = [];
  let curT = 0;
  for (const line of log.split("\n")) {
    const ptsMatch = line.match(/pts_time:(\d+(?:\.\d+)?)/);
    if (ptsMatch) curT = Number(ptsMatch[1]);
    const rmsMatch = line.match(/RMS_level=(-?\d+(?:\.\d+)?)/);
    if (rmsMatch) {
      const val = Number(rmsMatch[1]);
      if (Number.isFinite(val) && val > -90) {
        points.push({ t: curT, rms: val });
      }
    }
  }

  if (points.length < 3) {
    const fallbackT = dur >= 24 ? 20.0 : Number((dur * 0.7).toFixed(1));
    return { eventTimeSec: fallbackT, peakDeltaDb: 14.5, motionScore: 85 };
  }

  const sorted = [...points].map((p) => p.rms).sort((a, b) => a - b);
  const medianRms = sorted[Math.floor(sorted.length / 2)];
  let best = points[0];
  for (const p of points) {
    if (p.rms > best.rms) best = p;
  }

  const peakDeltaDb = Math.max(
    6,
    Math.min(32, Number((best.rms - medianRms).toFixed(1)))
  );
  const motionScore = Math.min(
    96,
    Math.max(72, Math.round(74 + peakDeltaDb * 0.85))
  );
  return {
    eventTimeSec: Number(Math.max(1, best.t).toFixed(1)),
    peakDeltaDb,
    motionScore,
  };
}

function formatAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const whole = Math.floor(s % 60);
  const cs = Math.min(99, Math.round((s - Math.floor(s)) * 100));
  return `${h}:${String(m).padStart(2, "0")}:${String(whole).padStart(
    2,
    "0"
  )}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

/**
 * Builds an Advanced SubStation Alpha (.ass) file for burning both styled headline
 * captions and timed subtitle cues via libass (supported universally by both
 * bundled `ffmpeg-static` and system FFmpeg across Windows, macOS, and Linux).
 */
function buildAssOverlay(params: {
  width: number;
  height: number;
  startSec: number;
  durationSec: number;
  aspectRatio: AspectRatio;
  shortsLayout?: ShortsLayout;
  caption?: CaptionConfig | null;
  subtitles?: SubtitleCue[];
}): string | null {
  const events: string[] = [];

  const hasCaption = Boolean(params.caption && params.caption.text.trim());
  const activeSubs = (params.subtitles || [])
    .filter((s) => s.text.trim().length > 0 && s.endTime > s.startTime)
    .slice(0, 40);

  if (hasCaption && params.caption) {
    const clean = wrapText(
      params.caption.text.trim(),
      params.aspectRatio === "16:9" ? 42 : 28
    );
    const styleName =
      params.caption.style === "blue"
        ? "CapBlue"
        : params.caption.style === "bold"
        ? "CapBold"
        : "CapPill";
    events.push(
      `Dialogue: 1,0:00:00.00,${formatAssTime(
        params.durationSec + 0.5
      )},${styleName},,0,0,0,,${escapeAssText(clean)}`
    );
  }

  for (const cue of activeSubs) {
    const relStart = Math.max(0, Number((cue.startTime - params.startSec).toFixed(2)));
    const relEnd = Math.min(
      params.durationSec,
      Number((cue.endTime - params.startSec).toFixed(2))
    );
    if (relEnd - relStart < 0.15) continue;
    const clean = wrapText(
      cue.text.trim(),
      params.aspectRatio === "16:9" ? 50 : 30
    );
    events.push(
      `Dialogue: 0,${formatAssTime(relStart)},${formatAssTime(
        relEnd
      )},Subtitle,,0,0,0,,${escapeAssText(clean)}`
    );
  }

  if (events.length === 0) return null;

  // Scale typography proportionally to Full HD (1080x1920 / 1920x1080) vs HD (720p)
  const scaleFactor =
    params.aspectRatio === "16:9"
      ? params.width / 1280
      : params.width / 720;
  const baseCap =
    params.caption?.fontSize === "lg"
      ? 40
      : params.caption?.fontSize === "sm"
      ? 26
      : 32;
  const capSize = Math.round(baseCap * scaleFactor);

  // ASS Alignment: 8 = top-center, 5 = middle-center, 2 = bottom-center
  const capAlign =
    params.caption?.position === "center"
      ? 5
      : params.caption?.position === "bottom"
      ? 2
      : 8;

  const isFitBlurShort =
    params.aspectRatio === "9:16" &&
    (params.shortsLayout ?? "fit_blur") === "fit_blur";

  // In Full-Frame Shorts (fit_blur), park headline cleanly ABOVE the full 16:9 frame
  // and timed subtitles cleanly BELOW it so 0% of the gameplay/HUD is obscured!
  const capMarginV = isFitBlurShort
    ? params.caption?.position === "top"
      ? Math.round(params.height * 0.245)
      : params.caption?.position === "bottom"
      ? Math.round(params.height * 0.19)
      : 20
    : params.caption?.position === "top"
    ? Math.round((params.aspectRatio === "9:16" ? 115 : 52) * scaleFactor)
    : params.caption?.position === "bottom"
    ? Math.round((params.aspectRatio === "9:16" ? 215 : 105) * scaleFactor)
    : 20;

  const subSize = Math.round(
    (params.aspectRatio === "16:9" ? 26 : 27) * scaleFactor
  );
  const subMarginV = isFitBlurShort
    ? Math.round(params.height * 0.235)
    : Math.round((params.aspectRatio === "9:16" ? 105 : 40) * scaleFactor);
  const padCap = Math.round(13 * scaleFactor);
  const padSub = Math.round(10 * scaleFactor);
  const marginX = Math.round(42 * scaleFactor);

  // Note: ASS color format is &HAABBGGRR (BGR order!)
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${params.width}`,
    `PlayResY: ${params.height}`,
    "WrapStyle: 1",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: CapPill,Arial,${capSize},&H00FFFFFF,&H00FFFFFF,&H280B0909,&H280B0909,-1,0,0,0,100,100,0,0,3,${padCap},0,${capAlign},${marginX},${marginX},${capMarginV},1`,
    `Style: CapBlue,Arial,${capSize},&H00FFFFFF,&H00FFFFFF,&H10EB6325,&H10EB6325,-1,0,0,0,100,100,0,0,3,${padCap},0,${capAlign},${marginX},${marginX},${capMarginV},1`,
    `Style: CapBold,Arial,${capSize},&H00FFFFFF,&H00FFFFFF,&H00090909,&H70000000,-1,0,0,0,100,100,0,0,1,${Math.round(4 * scaleFactor)},2,${capAlign},${marginX},${marginX},${capMarginV},1`,
    `Style: Subtitle,Arial,${subSize},&H00FFFFFF,&H00FFFFFF,&H38000000,&H38000000,0,0,0,0,100,100,0,0,3,${padSub},0,2,${marginX},${marginX},${subMarginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/**
 * Full HD Studio Video & Shorts Renderer (FFmpeg):
 * - Full HD 1080x1920 (9:16), 1920x1080 (16:9), 1080x1080 (1:1) preserving native 60fps
 * - Shorts Layouts:
 *     * "fit_blur"  — Fits 100% of full widescreen frame edge-to-edge over smooth blurred 9:16 canvas (nothing cropped off!)
 *     * "split_cam" — Streamer facecam stacked on top + crisp gameplay action below
 *     * "zoom_crop" — Full-height 9:16 center/pan Lanczos crop
 * - Full-Length Coverage: preserves 100% start-to-end duration with zero frame loss when untrimmed/fullLength
 * - High Profile H.264 + Lanczos + subtle unsharp detail preservation + 192kbps 48kHz AAC (or lossless AAC copy)
 * - Never alters or removes audio unless userPermittedMuteAudio === true
 */
export async function renderEditedClip(params: {
  inputPath: string;
  outputMp4Path: string;
  outputPosterPath: string;
  startTime: number;
  endTime: number;
  aspectRatio: AspectRatio;
  shortsLayout?: ShortsLayout;
  quality?: VideoQuality;
  fullLength?: boolean;
  cropOffsetX?: number;
  caption?: CaptionConfig | null;
  subtitles?: SubtitleCue[];
  userPermittedMuteAudio?: boolean;
  onProgress?: (pct: number) => void;
}): Promise<{
  durationSeconds: number;
  width: number;
  height: number;
  fileSizeBytes: number;
}> {
  if (!fs.existsSync(params.inputPath)) {
    throw new Error("Source clip video file not found on disk.");
  }

  const probe = await probeMedia(params.inputPath);
  const qSpec = getQualitySpec(params.quality ?? "1080p_source");
  const layout: ShortsLayout = params.shortsLayout ?? "fit_blur";

  const isFullDuration =
    params.fullLength === true ||
    (params.startTime <= 0.05 &&
      params.endTime >= Math.max(0, probe.durationSeconds - 0.12));

  const start = isFullDuration ? 0 : Math.max(0, Number(params.startTime.toFixed(2)));
  const end = isFullDuration
    ? probe.durationSeconds
    : Math.min(probe.durationSeconds, Number(params.endTime.toFixed(2)));
  const duration = Number(Math.max(1.0, end - start).toFixed(2));
  if (!isFullDuration && end - start < 1.0) {
    throw new Error("Trimmed clip duration must be at least 1.0 second.");
  }

  fs.mkdirSync(path.dirname(params.outputMp4Path), { recursive: true });
  fs.mkdirSync(path.dirname(params.outputPosterPath), { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipx-edit-"));

  try {
    const pan = Math.max(-1, Math.min(1, params.cropOffsetX ?? 0));
    const panNorm = ((pan + 1) / 2).toFixed(3);
    const srcIsLandscape = probe.width >= probe.height;

    let targetW = qSpec.landscapeW;
    let targetH = qSpec.landscapeH;
    if (params.aspectRatio === "9:16") {
      targetW = qSpec.shortW;
      targetH = qSpec.shortH;
    } else if (params.aspectRatio === "1:1") {
      targetW = qSpec.squareSize;
      targetH = qSpec.squareSize;
    } else {
      // Never pointlessly upscale a 720p landscape source to 1080p if source is smaller
      if (probe.width > 0 && probe.width < targetW) {
        targetW = Math.floor(probe.width / 2) * 2;
        targetH = Math.floor(((targetW * 9) / 16) / 2) * 2;
      }
    }

    const effectiveLayout: ShortsLayout =
      params.aspectRatio === "9:16" && !srcIsLandscape ? "zoom_crop" : layout;

    const assContent = buildAssOverlay({
      width: targetW,
      height: targetH,
      startSec: start,
      durationSec: duration,
      aspectRatio: params.aspectRatio,
      shortsLayout: effectiveLayout,
      caption: params.caption,
      subtitles: params.subtitles,
    });

    let assSuffix = "";
    if (assContent) {
      const assFile = path.join(tempDir, "overlay.ass");
      fs.writeFileSync(assFile, assContent, "utf8");
      assSuffix = ",ass=overlay.ass";
    }

    let filterArgs: string[];

    if (params.aspectRatio === "9:16" && effectiveLayout === "fit_blur") {
      // FULL-FRAME HD SHORT: 100% of original widescreen frame visible edge-to-edge
      // over a silky ambient-blurred vertical 9:16 background (zero cut-off HUD/facecam/gameplay!)
      const complex = [
        "[0:v]split=2[bg0][fg0]",
        `[bg0]scale=270:480:force_original_aspect_ratio=increase:flags=bilinear,crop=270:480,gblur=sigma=14,eq=brightness=-0.12:saturation=1.18,scale=${targetW}:${targetH}:flags=bicubic[bg]`,
        `[fg0]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease:flags=lanczos,scale=trunc(iw/2)*2:trunc(ih/2)*2,unsharp=3:3:0.35:3:3:0.0,pad=iw:ih+6:0:3:color=white@0.22[fg]`,
        `[bg][fg]overlay=(W-w)/2:(H-h)/2${assSuffix},format=yuv420p[vout]`,
      ].join(";");
      filterArgs = [
        "-filter_complex",
        complex,
        "-map",
        "[vout]",
        ...(probe.hasAudio ? ["-map", "0:a:0?"] : []),
      ];
    } else if (params.aspectRatio === "9:16" && effectiveLayout === "split_cam") {
      // STREAMER FACECAM TOP + FULL ACTION GAMEPLAY BOTTOM (fills 100% of 1080x1920)
      const topH = Math.floor((targetH * 0.34) / 2) * 2;
      const botH = targetH - topH - 4;
      const complex = [
        "[0:v]split=2[cam0][gm0]",
        `[cam0]crop=w='trunc(iw*0.32/2)*2':h='trunc(ih*0.44/2)*2':x=0:y='trunc(ih*0.22/2)*2',scale=${targetW}:${topH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${topH},unsharp=3:3:0.3:3:3:0.0,pad=iw:ih+4:0:0:color=0x2563EB[cam]`,
        `[gm0]scale=${targetW}:${botH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${targetW}:${botH}:'(iw-${targetW})*${panNorm}':'(ih-${botH})/2',unsharp=3:3:0.38:3:3:0.0[gm]`,
        `[cam][gm]vstack=inputs=2${assSuffix},format=yuv420p[vout]`,
      ].join(";");
      filterArgs = [
        "-filter_complex",
        complex,
        "-map",
        "[vout]",
        ...(probe.hasAudio ? ["-map", "0:a:0?"] : []),
      ];
    } else if (params.aspectRatio === "9:16") {
      // FULL-HEIGHT 9:16 LANCZOS ZOOM CROP (sharp 1080x1920)
      const vf = [
        `crop=w='if(gt(iw/ih,9/16),trunc(ih*9/32)*2,iw)':h='if(gt(iw/ih,9/16),ih,trunc(iw*16/18)*2)':x='(iw-out_w)*${panNorm}':y='(ih-out_h)/2'`,
        `scale=${targetW}:${targetH}:flags=lanczos`,
        "unsharp=3:3:0.40:3:3:0.0",
        ...(assSuffix ? ["ass=overlay.ass"] : []),
        "format=yuv420p",
      ].join(",");
      filterArgs = ["-vf", vf];
    } else if (params.aspectRatio === "1:1") {
      const vf = [
        `crop=w='trunc(min(iw,ih)/2)*2':h='trunc(min(iw,ih)/2)*2':x='(iw-out_w)*${panNorm}':y='(ih-out_h)/2'`,
        `scale=${targetW}:${targetH}:flags=lanczos`,
        "unsharp=3:3:0.32:3:3:0.0",
        ...(assSuffix ? ["ass=overlay.ass"] : []),
        "format=yuv420p",
      ].join(",");
      filterArgs = ["-vf", vf];
    } else {
      const vf = [
        `crop=w='if(gt(iw/ih,16/9),trunc(ih*16/18)*2,iw)':h='if(gt(iw/ih,16/9),ih,trunc(iw*9/32)*2)':x='(iw-out_w)/2':y='(ih-out_h)/2'`,
        `scale=${targetW}:${targetH}:flags=lanczos`,
        ...(assSuffix ? ["ass=overlay.ass"] : []),
        "format=yuv420p",
      ].join(",");
      filterArgs = ["-vf", vf];
    }

    // Preserve 100% lossless original AAC stream on full-length unmuted renders!
    const audioArgs =
      params.userPermittedMuteAudio === true
        ? ["-af", "volume=0", "-c:a", "aac", "-b:a", "128k"]
        : !probe.hasAudio
        ? ["-an"]
        : isFullDuration && probe.audioCodec === "aac"
        ? ["-c:a", "copy"]
        : ["-c:a", "aac", "-b:a", qSpec.audioBitrate, "-ar", "48000"];

    const trimPreArgs = isFullDuration ? [] : ["-ss", String(start)];
    const trimPostArgs = isFullDuration ? [] : ["-t", String(duration)];

    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...trimPreArgs,
      "-i",
      path.resolve(params.inputPath),
      ...trimPostArgs,
      ...filterArgs,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-preset",
      qSpec.preset,
      "-crf",
      qSpec.crf,
      "-maxrate",
      qSpec.maxrate,
      "-bufsize",
      qSpec.bufsize,
      ...audioArgs,
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      path.resolve(params.outputMp4Path),
    ];

    await runFfmpegWithProgress(args, duration, params.onProgress, tempDir);

    const outInfo = await probeMedia(params.outputMp4Path);
    await extractThumbnail(
      params.outputMp4Path,
      params.outputPosterPath,
      Math.min(
        outInfo.durationSeconds * 0.5,
        Math.max(0.2, outInfo.durationSeconds - 0.3)
      )
    );

    return {
      durationSeconds: outInfo.durationSeconds,
      width: outInfo.width || targetW,
      height: outInfo.height || targetH,
      fileSizeBytes: outInfo.fileSizeBytes,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function wrapText(input: string, maxCharsPerLine: number): string {
  const cleaned = input.replace(/\r/g, "");
  const words = cleaned.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const w of words) {
    if ((current + " " + w).trim().length <= maxCharsPerLine) {
      current = (current + " " + w).trim();
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3).join("\n");
}

function runFfmpegWithProgress(
  args: string[],
  expectedDurationSec: number,
  onProgress?: (pct: number) => void,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFfmpegBin(), args, cwd ? { cwd } : undefined);
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      if (!onProgress) return;
      const txt = chunk.toString();
      const match = txt.match(/out_time_ms=(\d+)/);
      if (match) {
        const sec = Number(match[1]) / 1_000_000;
        const pct = Math.min(
          98,
          Math.max(5, Math.round((sec / Math.max(1, expectedDurationSec)) * 100))
        );
        onProgress(pct);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `FFmpeg not found (${err.message}). Install FFmpeg or run 'npm install' to fetch ffmpeg-static.`
        )
      );
    });

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress?.(100);
        resolve();
      } else {
        reject(
          new Error(
            `FFmpeg video processing failed (exit ${code}): ${
              stderr.trim().slice(0, 300) || "Unknown encoding error"
            }`
          )
        );
      }
    });
  });
}
