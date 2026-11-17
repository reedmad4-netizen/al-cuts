import bcrypt from "bcryptjs";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isSupabaseConfigured } from "./supabase";
import type {
  AspectRatio,
  CaptionConfig,
  ChatMessageRecord,
  ChatSurgeRecord,
  ClipRecord,
  ClipStatus,
  DownloadRecord,
  ShortsLayout,
  StreamPlatform,
  StreamRecord,
  StreamStatus,
  SubtitleCue,
  UserProfile,
  UserSettings,
  VideoQuality,
} from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "clipx.db");

// Minimal types for sql.js (pure JS/WASM SQLite — zero native C++/Python build tools!)
type SqlValue = number | string | Uint8Array | null;

interface RawSqlStatement {
  bind(values?: SqlValue[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, SqlValue>;
  free(): boolean;
}

interface RawSqlJsDatabase {
  run(sql: string, params?: SqlValue[]): RawSqlJsDatabase;
  exec(sql: string): unknown;
  prepare(sql: string): RawSqlStatement;
  export(): Uint8Array;
  getRowsModified(): number;
}

interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => RawSqlJsDatabase;
}

export interface PreparedQuery {
  get: (...params: unknown[]) => Record<string, unknown> | undefined;
  all: (...params: unknown[]) => Array<Record<string, unknown>>;
  run: (...params: unknown[]) => { changes: number };
}

export interface SqlDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => PreparedQuery;
  flush: () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __clipxSqlJs: SqlJsStatic | undefined;
  // eslint-disable-next-line no-var
  var __clipxDb: SqlDatabase | undefined;
}

function normalizeParams(params: unknown[]): SqlValue[] {
  return params.map((val) => {
    if (val === undefined || val === null) return null;
    if (typeof val === "boolean") return val ? 1 : 0;
    if (typeof val === "number" || typeof val === "string") return val;
    if (val instanceof Uint8Array) return val;
    return String(val);
  });
}

function wrapSqlJsDatabase(raw: RawSqlJsDatabase, filePath: string): SqlDatabase {
  let batchDepth = 0;
  let dirty = false;

  const persistNow = () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const bytes = Buffer.from(raw.export());
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, bytes);
    fs.renameSync(tmpPath, filePath);
    dirty = false;
  };

  const maybePersist = () => {
    if (batchDepth === 0) {
      persistNow();
    } else {
      dirty = true;
    }
  };

  return {
    exec(sql: string) {
      batchDepth += 1;
      try {
        raw.exec(sql);
        dirty = true;
      } finally {
        batchDepth -= 1;
        if (batchDepth === 0 && dirty) persistNow();
      }
    },
    prepare(sql: string): PreparedQuery {
      return {
        get(...params: unknown[]) {
          const stmt = raw.prepare(sql);
          try {
            const bound = normalizeParams(params);
            if (bound.length > 0) stmt.bind(bound);
            if (!stmt.step()) return undefined;
            return { ...stmt.getAsObject() };
          } finally {
            stmt.free();
          }
        },
        all(...params: unknown[]) {
          const stmt = raw.prepare(sql);
          const rows: Array<Record<string, unknown>> = [];
          try {
            const bound = normalizeParams(params);
            if (bound.length > 0) stmt.bind(bound);
            while (stmt.step()) {
              rows.push({ ...stmt.getAsObject() });
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]) {
          const bound = normalizeParams(params);
          raw.run(sql, bound);
          const changes = raw.getRowsModified();
          maybePersist();
          return { changes };
        },
      };
    },
    flush() {
      persistNow();
    },
  };
}

export async function ensureSqlEngine(): Promise<SqlJsStatic> {
  if (globalThis.__clipxSqlJs) return globalThis.__clipxSqlJs;
  const req = createRequire(import.meta.url);
  const initSqlJs = req("sql.js") as (cfg: {
    wasmBinary: Buffer;
  }) => Promise<SqlJsStatic>;
  const wasmPath = path.join(
    process.cwd(),
    "node_modules",
    "sql.js",
    "dist",
    "sql-wasm.wasm"
  );
  globalThis.__clipxSqlJs = await initSqlJs({
    wasmBinary: fs.readFileSync(wasmPath),
  });
  return globalThis.__clipxSqlJs;
}

export function getDb(): SqlDatabase {
  if (!globalThis.__clipxDb) {
    const SQL = globalThis.__clipxSqlJs;
    if (!SQL) {
      throw new Error(
        "SQLite engine not initialized. Start the app with `npm run dev` or `npm start`."
      );
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let existing: Buffer | null = null;
    if (fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      if (buf.length > 0) existing = buf;
    }

    const raw = existing ? new SQL.Database(existing) : new SQL.Database();
    raw.exec("PRAGMA foreign_keys = ON;");
    const db = wrapSqlJsDatabase(raw, DB_PATH);
    initSchema(db);
    seedDemoData(db);
    syncPortableDemoPaths(db);
    globalThis.__clipxDb = db;
  }
  return globalThis.__clipxDb;
}

function initSchema(db: SqlDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      handle TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      avatar_color TEXT NOT NULL DEFAULT '#2563EB',
      is_demo_account INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      pre_buffer_seconds INTEGER NOT NULL DEFAULT 20,
      post_buffer_seconds INTEGER NOT NULL DEFAULT 8,
      min_ai_score INTEGER NOT NULL DEFAULT 65,
      hype_threshold INTEGER NOT NULL DEFAULT 70,
      dedupe_cooldown_seconds INTEGER NOT NULL DEFAULT 25,
      chat_spike_multiplier REAL NOT NULL DEFAULT 2.6,
      default_aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      video_quality TEXT NOT NULL DEFAULT '1080p_source',
      shorts_layout TEXT NOT NULL DEFAULT 'fit_blur',
      auto_shorts_enabled INTEGER NOT NULL DEFAULT 1,
      auto_shorts_caption INTEGER NOT NULL DEFAULT 1,
      auto_download_enabled INTEGER NOT NULL DEFAULT 1,
      music_detection_enabled INTEGER NOT NULL DEFAULT 1,
      warn_before_copyright_export INTEGER NOT NULL DEFAULT 1,
      show_demo_data INTEGER NOT NULL DEFAULT 1,
      twitch_client_id TEXT NOT NULL DEFAULT '',
      twitch_access_token TEXT NOT NULL DEFAULT '',
      youtube_api_key TEXT NOT NULL DEFAULT '',
      kick_api_token TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      game_name TEXT NOT NULL DEFAULT 'Gaming',
      platform TEXT NOT NULL,
      stream_url TEXT NOT NULL,
      local_source_path TEXT,
      preview_video_url TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      status_reason TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      is_authorized INTEGER NOT NULL DEFAULT 0,
      viewer_count INTEGER NOT NULL DEFAULT 0,
      pre_buffer_seconds INTEGER NOT NULL DEFAULT 20,
      post_buffer_seconds INTEGER NOT NULL DEFAULT 8,
      min_ai_score INTEGER NOT NULL DEFAULT 65,
      hype_threshold INTEGER NOT NULL DEFAULT 70,
      video_quality TEXT NOT NULL DEFAULT '1080p_source',
      shorts_layout TEXT NOT NULL DEFAULT 'fit_blur',
      auto_shorts_enabled INTEGER NOT NULL DEFAULT 1,
      auto_download_enabled INTEGER NOT NULL DEFAULT 1,
      dedupe_cooldown_seconds INTEGER NOT NULL DEFAULT 25,
      last_clip_event_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      stream_id TEXT REFERENCES streams(id) ON DELETE SET NULL,
      parent_clip_id TEXT REFERENCES clips(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      game_name TEXT NOT NULL,
      channel_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      video_url TEXT NOT NULL,
      poster_url TEXT NOT NULL,
      file_path TEXT NOT NULL,
      poster_path TEXT NOT NULL,
      duration_seconds REAL NOT NULL,
      pre_buffer_seconds REAL NOT NULL DEFAULT 20,
      post_buffer_seconds REAL NOT NULL DEFAULT 8,
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      width INTEGER NOT NULL DEFAULT 1280,
      height INTEGER NOT NULL DEFAULT 720,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      error_message TEXT,
      ai_score INTEGER NOT NULL DEFAULT 0,
      score_chat INTEGER NOT NULL DEFAULT 0,
      score_gameplay INTEGER NOT NULL DEFAULT 0,
      score_reactions INTEGER NOT NULL DEFAULT 0,
      score_events INTEGER NOT NULL DEFAULT 0,
      score_engagement INTEGER NOT NULL DEFAULT 0,
      trigger_reason TEXT NOT NULL DEFAULT '',
      ai_summary TEXT NOT NULL DEFAULT '',
      music_flagged INTEGER NOT NULL DEFAULT 0,
      music_confidence INTEGER NOT NULL DEFAULT 0,
      music_track_match TEXT NOT NULL DEFAULT '',
      music_details TEXT NOT NULL DEFAULT '',
      music_rms_db REAL NOT NULL DEFAULT -40.0,
      music_crest_factor REAL NOT NULL DEFAULT 20.0,
      audio_modified INTEGER NOT NULL DEFAULT 0,
      caption_json TEXT NOT NULL DEFAULT '',
      subtitles_json TEXT NOT NULL DEFAULT '[]',
      is_edited INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      owner_authorized INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      message TEXT NOT NULL,
      excitement_score INTEGER NOT NULL DEFAULT 0,
      matched_keywords TEXT NOT NULL DEFAULT '',
      is_spike INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_surges (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL REFERENCES streams(id) ON DELETE CASCADE,
      clip_id TEXT REFERENCES clips(id) ON DELETE SET NULL,
      channel_name TEXT NOT NULL,
      peak_rate_per_min INTEGER NOT NULL,
      baseline_rate_per_min INTEGER NOT NULL,
      multiplier REAL NOT NULL,
      top_keywords TEXT NOT NULL,
      outcome TEXT NOT NULL,
      outcome_note TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clip_downloads (
      id TEXT PRIMARY KEY,
      clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      clip_title TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'mp4',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      copyright_acknowledged INTEGER NOT NULL DEFAULT 0,
      saved_export_path TEXT NOT NULL DEFAULT '',
      is_demo INTEGER NOT NULL DEFAULT 0,
      downloaded_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_score ON clips(ai_score DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_stream ON chat_messages(stream_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_surges_created ON chat_surges(created_at DESC);
  `);

  // Seamless schema migration for existing v1.0–v1.2 databases
  const ensureColumn = (table: string, col: string, def: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => String(c.name) === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    }
  };
  ensureColumn("user_settings", "hype_threshold", "INTEGER NOT NULL DEFAULT 70");
  ensureColumn("user_settings", "video_quality", "TEXT NOT NULL DEFAULT '1080p_source'");
  ensureColumn("user_settings", "shorts_layout", "TEXT NOT NULL DEFAULT 'fit_blur'");
  ensureColumn("user_settings", "auto_shorts_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("user_settings", "auto_shorts_caption", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("user_settings", "auto_download_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("streams", "hype_threshold", "INTEGER NOT NULL DEFAULT 70");
  ensureColumn("streams", "video_quality", "TEXT NOT NULL DEFAULT '1080p_source'");
  ensureColumn("streams", "shorts_layout", "TEXT NOT NULL DEFAULT 'fit_blur'");
  ensureColumn("streams", "auto_shorts_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("streams", "auto_download_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("clip_downloads", "saved_export_path", "TEXT NOT NULL DEFAULT ''");
}

/**
 * Keeps built-in sample media paths valid across Windows/macOS/Linux even if the
 * project folder is moved after initial database creation.
 */
function syncPortableDemoPaths(db: SqlDatabase) {
  const feedPath = path.join(
    process.cwd(),
    "public",
    "media",
    "streams",
    "demo-feed.mp4"
  );
  // Reset any in-flight 'monitoring' state from a previous process exit back to 'ready'
  db.prepare(
    "UPDATE streams SET status = 'ready' WHERE status = 'monitoring'"
  ).run();
  db.prepare(
    "UPDATE streams SET local_source_path = ? WHERE id = 'stream-demo-sandbox'"
  ).run(feedPath);

  const sampleMap: Array<[string, string, string]> = [
    ["clip-demo-1", "clips/demo-fps-clutch.mp4", "posters/fps-clutch.jpg"],
    ["clip-demo-2", "clips/demo-br-finale.mp4", "posters/br-finale.jpg"],
    ["clip-demo-3", "clips/demo-cyber-race.mp4", "posters/cyber-race.jpg"],
    ["clip-demo-4", "clips/demo-boss-parry.mp4", "posters/boss-parry.jpg"],
  ];
  const stmt = db.prepare(
    "UPDATE clips SET file_path = ?, poster_path = ? WHERE id = ?"
  );
  for (const [id, mp4, poster] of sampleMap) {
    stmt.run(
      path.join(process.cwd(), "public", "media", ...mp4.split("/")),
      path.join(process.cwd(), "public", "media", ...poster.split("/")),
      id
    );
  }
}

function fileSizeSafe(p: string): number {
  try {
    return fs.existsSync(p) ? fs.statSync(p).size : 0;
  } catch {
    return 0;
  }
}

export function seedDemoData(db: SqlDatabase, forceReset = false) {
  const now = Date.now();
  const isoAgo = (min: number) => new Date(now - min * 60_000).toISOString();

  const existingDemoUser = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get("user-demo");
  if (!existingDemoUser) {
    const hash = bcrypt.hashSync("DemoClipX2026!", 10);
    db.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, handle, bio, avatar_color, is_demo_account, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    ).run(
      "user-demo",
      "demo@clipx.ai",
      hash,
      "Kai Mercer",
      "@kaimercer",
      "Competitive FPS & speedrun creator testing CLIPX AI Studio.",
      "#2563EB",
      isoAgo(1440)
    );
    db.prepare(
      `INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)`
    ).run("user-demo", isoAgo(60));
  }

  if (forceReset) {
    db.prepare("DELETE FROM clip_downloads WHERE is_demo = 1").run();
    db.prepare("DELETE FROM chat_surges WHERE is_demo = 1").run();
    db.prepare("DELETE FROM chat_messages WHERE is_demo = 1").run();
    db.prepare("DELETE FROM clips WHERE is_demo = 1").run();
    db.prepare("DELETE FROM streams WHERE is_demo = 1").run();
  }

  const existingStream = db
    .prepare("SELECT id FROM streams WHERE id = ?")
    .get("stream-demo-sandbox");
  if (!existingStream) {
    const feedPath = path.join(
      process.cwd(),
      "public",
      "media",
      "streams",
      "demo-feed.mp4"
    );
    db.prepare(
      `INSERT INTO streams (
        id, user_id, title, channel_name, game_name, platform, stream_url,
        local_source_path, preview_video_url, status, status_reason,
        is_demo, is_authorized, viewer_count, pre_buffer_seconds, post_buffer_seconds,
        min_ai_score, dedupe_cooldown_seconds, last_clip_event_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 20, 8, 65, 25, ?, ?)`
    ).run(
      "stream-demo-sandbox",
      null,
      "Ranked Immortal Finals & Night Drift [Sandbox Replay]",
      "kaimercer_demo",
      "Neon Protocol",
      "demo",
      "sandbox://clipx-demo-feed",
      feedPath,
      "/api/media/streams/demo-feed.mp4",
      "ready",
      "Demo simulation sandbox ready — start to run live 20s rolling buffer & simulated chat spikes (not a live external broadcast).",
      1840,
      isoAgo(14),
      isoAgo(240)
    );
  }

  const existingDemoClips = db
    .prepare("SELECT COUNT(*) as c FROM clips WHERE is_demo = 1")
    .get() as { c?: number } | undefined;
  if (!existingDemoClips || Number(existingDemoClips.c || 0) === 0) {
    const root = process.cwd();
    const demoClips = [
      {
        id: "clip-demo-1",
        title: "1v5 Neon Site Retake Ace in Overtime",
        game: "Neon Protocol",
        channel: "kaimercer_demo",
        mp4: "clips/demo-fps-clutch.mp4",
        poster: "posters/fps-clutch.jpg",
        duration: 28,
        pre: 20,
        post: 8,
        aiScore: 95,
        sChat: 97,
        sGame: 94,
        sReact: 93,
        sEvent: 98,
        sEngage: 92,
        trigger: "Chat velocity surged 4.8x + ACE in-game callout",
        summary:
          "Viral-tier highlight (95/100): 1v5 clutch site retake triggered a 4.8x chat burst ('CLIP IT', '1V5', 'ACE') with +21.4 dB reaction peak and sustained 92% viewer engagement.",
        musicFlagged: 0,
        musicConf: 8,
        musicTrack: "",
        musicDetails:
          "Clean gameplay & reaction audio verified (-38.3 dB mid-band RMS, 36.6x transient crest). No sustained copyrighted music detected.",
        rms: -38.33,
        crest: 36.59,
        subs: JSON.stringify([
          {
            id: "s1",
            startTime: 8.0,
            endTime: 12.2,
            text: "Last player standing — rotating through neon B main.",
          },
          {
            id: "s2",
            startTime: 15.0,
            endTime: 18.8,
            text: "Hold steady, wait for the barrier drop...",
          },
          {
            id: "s3",
            startTime: 19.8,
            endTime: 23.6,
            text: "ACE! ONE VERSUS FIVE! CLIP THAT RIGHT NOW!",
          },
          {
            id: "s4",
            startTime: 24.0,
            endTime: 27.2,
            text: "No shot we just pulled that off in overtime!",
          },
        ]),
        minsAgo: 14,
      },
      {
        id: "clip-demo-2",
        title: "Final Ring 6 Jump-Pad Squad Wipe for Champion",
        game: "Apex Horizon",
        channel: "kaimercer_demo",
        mp4: "clips/demo-br-finale.mp4",
        poster: "posters/br-finale.jpg",
        duration: 30,
        pre: 20,
        post: 10,
        aiScore: 89,
        sChat: 88,
        sGame: 91,
        sReact: 86,
        sEvent: 92,
        sEngage: 87,
        trigger: "High-ground shield break + CHAMPION event + 3.7x chat surge",
        summary:
          "High-impact gaming moment (89/100): End-game Ring 6 aerial wipe sparked a 3.7x chat surge ('CHAMPION', 'INSANE', 'LETS GO') with 91% gameplay intensity.",
        musicFlagged: 0,
        musicConf: 9,
        musicTrack: "",
        musicDetails:
          "Clean gameplay & reaction audio verified (-38.1 dB mid-band RMS, 35.8x transient crest). No copyrighted music detected.",
        rms: -38.1,
        crest: 35.8,
        subs: JSON.stringify([
          {
            id: "s1",
            startTime: 14.2,
            endTime: 18.5,
            text: "Taking jump pad over the closing storm ring!",
          },
          {
            id: "s2",
            startTime: 19.8,
            endTime: 24.2,
            text: "SQUAD WIPE! WE ARE THE CHAMPIONS!",
          },
        ]),
        minsAgo: 42,
      },
      {
        id: "clip-demo-3",
        title: "Tokyo Expressway Hairpin Drift +0.012s Record",
        game: "Velocity Zero",
        channel: "kaimercer_demo",
        mp4: "clips/demo-cyber-race.mp4",
        poster: "posters/cyber-race.jpg",
        duration: 26,
        pre: 20,
        post: 6,
        aiScore: 84,
        sChat: 83,
        sGame: 87,
        sReact: 79,
        sEvent: 88,
        sEngage: 82,
        trigger: "Record photo finish (+0.012s) + 3.2x chat velocity spike",
        summary:
          "High-impact gaming moment (84/100): Wet-track nitro drift edged course record by 0.012s with 3.2x chat spike. Flagged for sustained licensed-style synthwave backing track.",
        musicFlagged: 1,
        musicConf: 89,
        musicTrack: "Nightrunner Synthwave — Licensed Radio Mix (Acoustic Match)",
        musicDetails:
          "Continuous harmonic music bed detected across 0:00–0:26 (-14.05 dB mid-band RMS, 3.05x compressed crest factor). May trigger Content ID or DMCA claim. Original audio preserved untouched.",
        rms: -14.05,
        crest: 3.05,
        subs: JSON.stringify([
          {
            id: "s1",
            startTime: 14.5,
            endTime: 19.0,
            text: "Full nitrous out of the final Tokyo hairpin!",
          },
          {
            id: "s2",
            startTime: 19.8,
            endTime: 24.4,
            text: "NEW RECORD BY TWELVE THOUSANDTHS!",
          },
        ]),
        minsAgo: 95,
      },
      {
        id: "clip-demo-4",
        title: "No-Hit Storm Dragon Frame-Perfect Parry Stagger",
        game: "Ashen Crown",
        channel: "kaimercer_demo",
        mp4: "clips/demo-boss-parry.mp4",
        poster: "posters/boss-parry.jpg",
        duration: 28,
        pre: 20,
        post: 8,
        aiScore: 78,
        sChat: 76,
        sGame: 81,
        sReact: 74,
        sEvent: 84,
        sEngage: 73,
        trigger: "Boss stagger parry flash + 2.9x chat spike ('PARRY', 'CLEAN')",
        summary:
          "Strong clip candidate (78/100): Frame-perfect cathedral boss deflection at 1 HP generated a 2.9x chat velocity jump and crisp visual contrast burst.",
        musicFlagged: 0,
        musicConf: 10,
        musicTrack: "",
        musicDetails:
          "Clean boss combat SFX verified (-38.2 dB mid-band RMS, 36.1x transient crest). Clear for export.",
        rms: -38.2,
        crest: 36.1,
        subs: JSON.stringify([
          {
            id: "s1",
            startTime: 16.0,
            endTime: 19.4,
            text: "One pixel of stamina — have to parry this slam.",
          },
          {
            id: "s2",
            startTime: 19.8,
            endTime: 24.0,
            text: "FRAME PERFECT! HE'S STAGGERED!",
          },
        ]),
        minsAgo: 165,
      },
    ];

    const insertClip = db.prepare(`
      INSERT INTO clips (
        id, user_id, stream_id, parent_clip_id, title, game_name, channel_name, platform,
        video_url, poster_url, file_path, poster_path, duration_seconds, pre_buffer_seconds,
        post_buffer_seconds, aspect_ratio, width, height, file_size_bytes, status,
        ai_score, score_chat, score_gameplay, score_reactions, score_events, score_engagement,
        trigger_reason, ai_summary, music_flagged, music_confidence, music_track_match,
        music_details, music_rms_db, music_crest_factor, audio_modified, caption_json,
        subtitles_json, is_edited, is_demo, owner_authorized, created_at
      ) VALUES (
        ?, null, 'stream-demo-sandbox', null, ?, ?, ?, 'demo',
        ?, ?, ?, ?, ?, ?, ?, '16:9', 1280, 720, ?, 'ready',
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, 0, '',
        ?, 0, 1, 1, ?
      )
    `);

    for (const c of demoClips) {
      const absVideo = path.join(root, "public", "media", ...c.mp4.split("/"));
      const absPoster = path.join(
        root,
        "public",
        "media",
        ...c.poster.split("/")
      );
      insertClip.run(
        c.id,
        c.title,
        c.game,
        c.channel,
        `/api/media/${c.mp4}`,
        `/api/media/${c.poster}`,
        absVideo,
        absPoster,
        c.duration,
        c.pre,
        c.post,
        fileSizeSafe(absVideo),
        c.aiScore,
        c.sChat,
        c.sGame,
        c.sReact,
        c.sEvent,
        c.sEngage,
        c.trigger,
        c.summary,
        c.musicFlagged,
        c.musicConf,
        c.musicTrack,
        c.musicDetails,
        c.rms,
        c.crest,
        c.subs,
        isoAgo(c.minsAgo)
      );
    }

    const insertSurge = db.prepare(`
      INSERT INTO chat_surges (
        id, stream_id, clip_id, channel_name, peak_rate_per_min, baseline_rate_per_min,
        multiplier, top_keywords, outcome, outcome_note, is_demo, created_at
      ) VALUES (?, 'stream-demo-sandbox', ?, 'kaimercer_demo', ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    insertSurge.run(
      "surge-demo-1",
      "clip-demo-1",
      144,
      30,
      4.8,
      "CLIP IT,1V5,ACE,NO WAY",
      "clip_generated",
      "Saved 20s pre-buffer + 8s post-event (AI Score 95/100)",
      isoAgo(14)
    );
    insertSurge.run(
      "surge-demo-2",
      null,
      112,
      30,
      3.7,
      "OMG,GOAT,CLIP THAT",
      "duplicate_suppressed",
      "Suppressed duplicate — occurred 9.4s after clip-demo-1 within 25s cooldown window",
      isoAgo(13.8)
    );
    insertSurge.run(
      "surge-demo-3",
      "clip-demo-2",
      118,
      32,
      3.69,
      "CHAMPION,WIPE,INSANE,LETS GO",
      "clip_generated",
      "Saved 20s pre-buffer + 10s post-event (AI Score 89/100)",
      isoAgo(42)
    );
    insertSurge.run(
      "surge-demo-4",
      "clip-demo-3",
      96,
      30,
      3.2,
      "RECORD,WHAT,CRAZY,W",
      "clip_generated",
      "Saved 20s pre-buffer + 6s post-event (AI Score 84/100 · Music Warning Flagged)",
      isoAgo(95)
    );

    const sampleChat: Array<[string, string, number, string, number, number]> = [
      ["vex_aim", "crosshair placement on B site is crispy today", 14, "CLEAN", 0, 15.2],
      ["nova99", "wait are they rushing neon barrier with 18s left?", 0, "", 0, 14.9],
      ["jettmain_tv", "1v5 situation oh no", 30, "1V5", 0, 14.5],
      ["pixelated_k", "WAIT TWO HEADSHOTS ALREADY", 38, "HEADSHOT", 1, 14.2],
      ["synth_kai", "NO WAY HE HITS THE THIRD!!", 50, "NO WAY", 1, 14.1],
      ["draco_gg", "ACEEEE!! CLIP IT RIGHT NOW!!", 82, "ACE,CLIP IT", 1, 14.0],
      ["mira_plays", "1V5 CLUTCH IN OVERTIME OMG!!", 88, "1V5,CLUTCH,OMG", 1, 13.98],
      ["turbo_zed", "CLIP THAT!! ABSOLUTELY INSANE", 76, "CLIP THAT,INSANE", 1, 13.95],
      ["lumen_fps", "GOAT BEHAVIOR LETS GO W", 64, "GOAT,LETS GO,W", 1, 13.9],
      ["koda_live", "gg that is going straight to shorts", 10, "GG", 0, 13.5],
    ];
    const insertMsg = db.prepare(`
      INSERT INTO chat_messages (id, stream_id, author, message, excitement_score, matched_keywords, is_spike, is_demo, created_at)
      VALUES (?, 'stream-demo-sandbox', ?, ?, ?, ?, ?, 1, ?)
    `);
    sampleChat.forEach((m, i) => {
      insertMsg.run(`msg-demo-${i + 1}`, m[0], m[1], m[2], m[3], m[4], isoAgo(m[5]));
    });
  }
}

// ---------------------------------------------------------------------------
// Row Mappers
// ---------------------------------------------------------------------------

export function mapUserRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    handle: String(row.handle),
    bio: String(row.bio || ""),
    avatarColor: String(row.avatar_color || "#2563EB"),
    isDemoAccount: Boolean(row.is_demo_account),
    createdAt: String(row.created_at),
  };
}

export function mapSettingsRow(row: Record<string, unknown>): UserSettings {
  const twitchId = String(
    row.twitch_client_id || process.env.TWITCH_CLIENT_ID || ""
  );
  const twitchToken = String(
    row.twitch_access_token || process.env.TWITCH_ACCESS_TOKEN || ""
  );
  const ytKey = String(row.youtube_api_key || process.env.YOUTUBE_API_KEY || "");
  const kickToken = String(row.kick_api_token || process.env.KICK_API_TOKEN || "");

  return {
    userId: String(row.user_id),
    preBufferSeconds: 20,
    postBufferSeconds: Number(row.post_buffer_seconds ?? 8),
    minAiScore: Number(row.min_ai_score ?? 65),
    hypeThreshold: Number(row.hype_threshold ?? 70),
    dedupeCooldownSeconds: Number(row.dedupe_cooldown_seconds ?? 25),
    chatSpikeMultiplier: Number(row.chat_spike_multiplier ?? 2.6),
    defaultAspectRatio: (row.default_aspect_ratio as AspectRatio) || "16:9",
    videoQuality: (row.video_quality as VideoQuality) || "1080p_source",
    shortsLayout: (row.shorts_layout as ShortsLayout) || "fit_blur",
    autoShortsEnabled:
      row.auto_shorts_enabled === undefined
        ? true
        : Boolean(row.auto_shorts_enabled),
    autoShortsCaption:
      row.auto_shorts_caption === undefined
        ? true
        : Boolean(row.auto_shorts_caption),
    autoDownloadEnabled:
      row.auto_download_enabled === undefined
        ? true
        : Boolean(row.auto_download_enabled),
    musicDetectionEnabled: Boolean(row.music_detection_enabled),
    warnBeforeCopyrightExport: Boolean(row.warn_before_copyright_export),
    showDemoData: Boolean(row.show_demo_data),
    twitchConfigured: Boolean(twitchId && twitchToken),
    twitchClientId: twitchId,
    youtubeConfigured: Boolean(ytKey),
    kickConfigured: Boolean(kickToken),
    supabaseConfigured: isSupabaseConfigured(),
    updatedAt: String(row.updated_at),
  };
}

export function mapStreamRow(row: Record<string, unknown>): StreamRecord {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    title: String(row.title),
    channelName: String(row.channel_name),
    gameName: String(row.game_name),
    platform: row.platform as StreamPlatform,
    streamUrl: String(row.stream_url),
    localSourcePath: row.local_source_path ? String(row.local_source_path) : null,
    previewVideoUrl: row.preview_video_url ? String(row.preview_video_url) : null,
    status: row.status as StreamStatus,
    statusReason: String(row.status_reason || ""),
    isDemo: Boolean(row.is_demo),
    isAuthorized: Boolean(row.is_authorized),
    viewerCount: Number(row.viewer_count || 0),
    preBufferSeconds: Number(row.pre_buffer_seconds || 20),
    postBufferSeconds: Number(row.post_buffer_seconds || 8),
    minAiScore: Number(row.min_ai_score || 65),
    hypeThreshold: Number(row.hype_threshold ?? 70),
    videoQuality: (row.video_quality as VideoQuality) || "1080p_source",
    shortsLayout: (row.shorts_layout as ShortsLayout) || "fit_blur",
    autoShortsEnabled:
      row.auto_shorts_enabled === undefined
        ? true
        : Boolean(row.auto_shorts_enabled),
    autoDownloadEnabled:
      row.auto_download_enabled === undefined
        ? true
        : Boolean(row.auto_download_enabled),
    dedupeCooldownSeconds: Number(row.dedupe_cooldown_seconds || 25),
    lastClipEventAt: row.last_clip_event_at ? String(row.last_clip_event_at) : null,
    createdAt: String(row.created_at),
  };
}

export interface ClipRowWithPaths extends ClipRecord {
  filePath: string;
  posterPath: string;
}

export function mapClipRow(row: Record<string, unknown>): ClipRowWithPaths {
  let caption: CaptionConfig | null = null;
  if (row.caption_json && String(row.caption_json).trim()) {
    try {
      caption = JSON.parse(String(row.caption_json));
    } catch {
      caption = null;
    }
  }
  let subtitles: SubtitleCue[] = [];
  if (row.subtitles_json) {
    try {
      const parsed = JSON.parse(String(row.subtitles_json));
      if (Array.isArray(parsed)) subtitles = parsed;
    } catch {
      subtitles = [];
    }
  }

  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    streamId: row.stream_id ? String(row.stream_id) : null,
    parentClipId: row.parent_clip_id ? String(row.parent_clip_id) : null,
    title: String(row.title),
    gameName: String(row.game_name),
    channelName: String(row.channel_name),
    platform: row.platform as StreamPlatform,
    videoUrl: String(row.video_url),
    posterUrl: String(row.poster_url),
    filePath: String(row.file_path),
    posterPath: String(row.poster_path),
    durationSeconds: Number(row.duration_seconds || 0),
    preBufferSeconds: Number(row.pre_buffer_seconds || 20),
    postBufferSeconds: Number(row.post_buffer_seconds || 8),
    aspectRatio: (row.aspect_ratio as AspectRatio) || "16:9",
    width: Number(row.width || 1280),
    height: Number(row.height || 720),
    fileSizeBytes: Number(row.file_size_bytes || 0),
    status: (row.status as ClipStatus) || "ready",
    errorMessage: row.error_message ? String(row.error_message) : null,
    aiScore: Number(row.ai_score || 0),
    scores: {
      total: Number(row.ai_score || 0),
      chatActivity: Number(row.score_chat || 0),
      gameplayMoments: Number(row.score_gameplay || 0),
      suddenReactions: Number(row.score_reactions || 0),
      inGameEvents: Number(row.score_events || 0),
      viewerEngagement: Number(row.score_engagement || 0),
    },
    triggerReason: String(row.trigger_reason || ""),
    aiSummary: String(row.ai_summary || ""),
    music: {
      flagged: Boolean(row.music_flagged),
      confidence: Number(row.music_confidence || 0),
      trackMatch: String(row.music_track_match || ""),
      details: String(row.music_details || ""),
      rmsDb: Number(row.music_rms_db ?? -40),
      crestFactor: Number(row.music_crest_factor ?? 20),
      audioModified: Boolean(row.audio_modified),
    },
    caption,
    subtitles,
    isEdited: Boolean(row.is_edited),
    isDemo: Boolean(row.is_demo),
    ownerAuthorized: Boolean(row.owner_authorized),
    createdAt: String(row.created_at),
  };
}

export function stripInternalClipPaths(clip: ClipRowWithPaths): ClipRecord {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { filePath, posterPath, ...pub } = clip;
  return pub;
}

export function mapChatRow(row: Record<string, unknown>): ChatMessageRecord {
  const kw = String(row.matched_keywords || "");
  return {
    id: String(row.id),
    streamId: String(row.stream_id),
    author: String(row.author),
    message: String(row.message),
    excitementScore: Number(row.excitement_score || 0),
    matchedKeywords: kw ? kw.split(",").filter(Boolean) : [],
    isSpike: Boolean(row.is_spike),
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
  };
}

export function mapSurgeRow(row: Record<string, unknown>): ChatSurgeRecord {
  const kw = String(row.top_keywords || "");
  return {
    id: String(row.id),
    streamId: String(row.stream_id),
    clipId: row.clip_id ? String(row.clip_id) : null,
    channelName: String(row.channel_name),
    peakRatePerMin: Number(row.peak_rate_per_min || 0),
    baselineRatePerMin: Number(row.baseline_rate_per_min || 0),
    multiplier: Number(row.multiplier || 1),
    topKeywords: kw ? kw.split(",").filter(Boolean) : [],
    outcome: row.outcome as ChatSurgeRecord["outcome"],
    outcomeNote: String(row.outcome_note || ""),
    isDemo: Boolean(row.is_demo),
    createdAt: String(row.created_at),
  };
}

export function mapDownloadRow(row: Record<string, unknown>): DownloadRecord {
  return {
    id: String(row.id),
    clipId: String(row.clip_id),
    userId: row.user_id ? String(row.user_id) : null,
    clipTitle: String(row.clip_title),
    format: String(row.format || "mp4"),
    aspectRatio: (row.aspect_ratio as AspectRatio) || "16:9",
    fileSizeBytes: Number(row.file_size_bytes || 0),
    copyrightAcknowledged: Boolean(row.copyright_acknowledged),
    savedExportPath: String(row.saved_export_path || ""),
    isDemo: Boolean(row.is_demo),
    downloadedAt: String(row.downloaded_at),
  };
}

export function getExportsDir(): string {
  return path.join(process.cwd(), "exports");
}

/**
 * Copies a clip MP4 into `clipx-ai/exports/` with a clean, paired filename so
 * BOTH the Original (16:9) file and the Auto-Short (9:16) file are saved
 * side-by-side on disk automatically.
 */
export function saveClipToExportsFolder(params: {
  sourceFilePath: string;
  channelName: string;
  gameName: string;
  variant: "original" | "short_9x16" | "square_1x1" | "edited";
  groupStamp?: string;
}): {
  relativePath: string;
  absPath: string;
  fileName: string;
  sizeBytes: number;
} | null {
  try {
    if (!fs.existsSync(params.sourceFilePath)) return null;
    const exportsDir = getExportsDir();
    fs.mkdirSync(exportsDir, { recursive: true });

    const safeCh =
      params.channelName
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 26) || "stream";
    const safeGame =
      params.gameName
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 20) || "live";
    const stamp =
      params.groupStamp ||
      new Date().toISOString().slice(0, 19).replace(/[:]/g, "-");
    const tag =
      params.variant === "short_9x16"
        ? "SHORT_9x16"
        : params.variant === "square_1x1"
        ? "SQUARE_1x1"
        : params.variant === "edited"
        ? "EDITED_16x9"
        : "ORIGINAL_16x9";

    const fileName = `${safeCh}_${safeGame}_${stamp}_${tag}.mp4`;
    const absPath = path.join(exportsDir, fileName);
    fs.copyFileSync(params.sourceFilePath, absPath);
    const stat = fs.statSync(absPath);
    return {
      relativePath: `exports/${fileName}`,
      absPath,
      fileName,
      sizeBytes: stat.size,
    };
  } catch {
    return null;
  }
}

export function getEffectiveSettings(userId: string | null): UserSettings & {
  rawTwitchToken: string;
  rawYoutubeKey: string;
  rawKickToken: string;
} {
  const db = getDb();
  const targetId = userId || "user-demo";
  let row = db
    .prepare("SELECT * FROM user_settings WHERE user_id = ?")
    .get(targetId) as Record<string, unknown> | undefined;

  if (!row && userId) {
    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR IGNORE INTO user_settings (user_id, updated_at) VALUES (?, ?)"
    ).run(userId, now);
    row = db
      .prepare("SELECT * FROM user_settings WHERE user_id = ?")
      .get(userId) as Record<string, unknown> | undefined;
  }

  if (!row) {
    row = {
      user_id: targetId,
      pre_buffer_seconds: 20,
      post_buffer_seconds: 8,
      min_ai_score: 65,
      dedupe_cooldown_seconds: 25,
      chat_spike_multiplier: 2.6,
      default_aspect_ratio: "16:9",
      music_detection_enabled: 1,
      warn_before_copyright_export: 1,
      show_demo_data: 1,
      twitch_client_id: "",
      twitch_access_token: "",
      youtube_api_key: "",
      kick_api_token: "",
      updated_at: new Date().toISOString(),
    };
  }

  return {
    ...mapSettingsRow(row),
    rawTwitchToken: String(
      row.twitch_access_token || process.env.TWITCH_ACCESS_TOKEN || ""
    ),
    rawYoutubeKey: String(
      row.youtube_api_key || process.env.YOUTUBE_API_KEY || ""
    ),
    rawKickToken: String(
      row.kick_api_token || process.env.KICK_API_TOKEN || ""
    ),
  };
}
