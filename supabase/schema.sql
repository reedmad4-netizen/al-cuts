-- CLIPX AI — PostgreSQL / Supabase Database Schema
-- Compatible with Supabase Auth (auth.users) and standalone PostgreSQL

create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  display_name text not null,
  handle text not null,
  bio text default '',
  avatar_color text default '#2563EB',
  is_demo_account boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.user_settings (
  user_id text primary key references public.users(id) on delete cascade,
  pre_buffer_seconds integer not null default 20 check (pre_buffer_seconds = 20),
  post_buffer_seconds integer not null default 8 check (post_buffer_seconds between 3 and 45),
  min_ai_score integer not null default 65 check (min_ai_score between 0 and 100),
  hype_threshold integer not null default 70 check (hype_threshold between 30 and 95),
  video_quality text not null default '1080p_source' check (video_quality in ('1080p_source', '1080p_high', '720p_balanced')),
  shorts_layout text not null default 'fit_blur' check (shorts_layout in ('fit_blur', 'split_cam', 'zoom_crop')),
  auto_shorts_enabled boolean not null default true,
  auto_shorts_caption boolean not null default true,
  auto_download_enabled boolean not null default true,
  dedupe_cooldown_seconds integer not null default 25 check (dedupe_cooldown_seconds between 10 and 120),
  chat_spike_multiplier numeric(4,2) not null default 2.60,
  default_aspect_ratio text not null default '16:9' check (default_aspect_ratio in ('16:9', '9:16', '1:1')),
  music_detection_enabled boolean not null default true,
  warn_before_copyright_export boolean not null default true,
  show_demo_data boolean not null default true,
  twitch_client_id text default '',
  twitch_access_token text default '',
  youtube_api_key text default '',
  kick_api_token text default '',
  updated_at timestamptz default now()
);

create table if not exists public.streams (
  id text primary key,
  user_id text references public.users(id) on delete cascade,
  title text not null,
  channel_name text not null,
  game_name text not null default 'Gaming',
  platform text not null check (platform in ('twitch', 'youtube', 'kick', 'hls', 'upload', 'demo')),
  stream_url text not null,
  local_source_path text,
  status text not null default 'offline'
    check (status in ('monitoring', 'ready', 'offline', 'credentials_required', 'error')),
  status_reason text default '',
  is_demo boolean not null default false,
  is_authorized boolean not null default false,
  viewer_count integer not null default 0,
  pre_buffer_seconds integer not null default 20,
  post_buffer_seconds integer not null default 8,
  min_ai_score integer not null default 65,
  hype_threshold integer not null default 70 check (hype_threshold between 30 and 95),
  video_quality text not null default '1080p_source' check (video_quality in ('1080p_source', '1080p_high', '720p_balanced')),
  shorts_layout text not null default 'fit_blur' check (shorts_layout in ('fit_blur', 'split_cam', 'zoom_crop')),
  auto_shorts_enabled boolean not null default true,
  auto_download_enabled boolean not null default true,
  dedupe_cooldown_seconds integer not null default 25,
  last_clip_event_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.clips (
  id text primary key,
  user_id text references public.users(id) on delete cascade,
  stream_id text references public.streams(id) on delete set null,
  parent_clip_id text references public.clips(id) on delete set null,
  title text not null,
  game_name text not null,
  channel_name text not null,
  platform text not null,
  video_url text not null,
  poster_url text not null,
  file_path text not null,
  poster_path text not null,
  duration_seconds numeric(6,2) not null,
  pre_buffer_seconds numeric(5,2) not null default 20,
  post_buffer_seconds numeric(5,2) not null default 8,
  aspect_ratio text not null default '16:9' check (aspect_ratio in ('16:9', '9:16', '1:1')),
  width integer not null default 1280,
  height integer not null default 720,
  file_size_bytes bigint not null default 0,
  status text not null default 'ready'
    check (status in ('buffering', 'capturing', 'encoding', 'scoring', 'ready', 'failed')),
  error_message text,
  ai_score integer not null default 0 check (ai_score between 0 and 100),
  score_chat integer not null default 0,
  score_gameplay integer not null default 0,
  score_reactions integer not null default 0,
  score_events integer not null default 0,
  score_engagement integer not null default 0,
  trigger_reason text not null default '',
  ai_summary text not null default '',
  music_flagged boolean not null default false,
  music_confidence integer not null default 0,
  music_track_match text default '',
  music_details text default '',
  music_rms_db numeric(6,2) default -40.0,
  music_crest_factor numeric(6,2) default 20.0,
  audio_modified boolean not null default false,
  caption_json text default '',
  subtitles_json text default '[]',
  is_edited boolean not null default false,
  is_demo boolean not null default false,
  owner_authorized boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.chat_messages (
  id text primary key,
  stream_id text references public.streams(id) on delete cascade,
  author text not null,
  message text not null,
  excitement_score integer not null default 0,
  matched_keywords text default '',
  is_spike boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists public.chat_surges (
  id text primary key,
  stream_id text references public.streams(id) on delete cascade,
  clip_id text references public.clips(id) on delete set null,
  channel_name text not null,
  peak_rate_per_min integer not null,
  baseline_rate_per_min integer not null,
  multiplier numeric(5,2) not null,
  top_keywords text not null,
  outcome text not null check (outcome in ('clip_generated', 'duplicate_suppressed', 'below_threshold')),
  outcome_note text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists public.clip_downloads (
  id text primary key,
  clip_id text references public.clips(id) on delete cascade,
  user_id text references public.users(id) on delete set null,
  clip_title text not null,
  format text not null default 'mp4',
  aspect_ratio text not null default '16:9',
  file_size_bytes bigint not null default 0,
  copyright_acknowledged boolean not null default false,
  saved_export_path text,
  is_demo boolean not null default false,
  downloaded_at timestamptz default now()
);

create index if not exists idx_clips_user_created on public.clips(user_id, created_at desc);
create index if not exists idx_clips_score on public.clips(ai_score desc);
create index if not exists idx_chat_stream_created on public.chat_messages(stream_id, created_at desc);
create index if not exists idx_surges_created on public.chat_surges(created_at desc);

-- Row-Level Security policies for Supabase production deployment
alter table public.clips enable row level security;
alter table public.streams enable row level security;
alter table public.user_settings enable row level security;

-- The three tables above previously enabled RLS without a single policy,
-- which denies every non-service-role client. The policies below implement
-- the same ownership rules the API enforces: rows belong to their user,
-- unowned rows are read-only shared/demo data.
alter table public.users enable row level security;
alter table public.clip_downloads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_surges enable row level security;

drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (auth.uid()::text = id);

drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (auth.uid()::text = id) with check (auth.uid()::text = id);

drop policy if exists user_settings_owner on public.user_settings;
create policy user_settings_owner on public.user_settings
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists clips_read on public.clips;
create policy clips_read on public.clips
  for select using (user_id is null or auth.uid()::text = user_id);

drop policy if exists clips_write on public.clips;
create policy clips_write on public.clips
  for insert with check (auth.uid()::text = user_id);

drop policy if exists clips_update on public.clips;
create policy clips_update on public.clips
  for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists clips_delete on public.clips;
create policy clips_delete on public.clips
  for delete using (auth.uid()::text = user_id);

drop policy if exists streams_read on public.streams;
create policy streams_read on public.streams
  for select using (user_id is null or auth.uid()::text = user_id);

drop policy if exists streams_write on public.streams;
create policy streams_write on public.streams
  for insert with check (auth.uid()::text = user_id);

drop policy if exists streams_update on public.streams;
create policy streams_update on public.streams
  for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists streams_delete on public.streams;
create policy streams_delete on public.streams
  for delete using (auth.uid()::text = user_id);

drop policy if exists downloads_owner on public.clip_downloads;
create policy downloads_owner on public.clip_downloads
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);

drop policy if exists chat_public_read on public.chat_messages;
create policy chat_public_read on public.chat_messages
  for select using (true);

drop policy if exists surges_public_read on public.chat_surges;
create policy surges_public_read on public.chat_surges
  for select using (true);

-- ---------------------------------------------------------------------------
-- Instagram publishing + S3-compatible media hosting (v1.6.0)
--
-- The local sql.js database migrates itself at boot (ensureColumn); these
-- statements bring an existing PostgreSQL / Supabase project to the same shape.
-- Every column is additive, so the file stays idempotent.
-- ---------------------------------------------------------------------------

alter table public.user_settings add column if not exists instagram_user_id text not null default '';
alter table public.user_settings add column if not exists instagram_access_token text not null default '';
alter table public.user_settings add column if not exists instagram_api_version text not null default '';
-- 'facebook' = Instagram API with Facebook Login, 'instagram' = Instagram Login
alter table public.user_settings add column if not exists instagram_login_method text not null default ''
  check (instagram_login_method in ('', 'facebook', 'instagram'));
alter table public.user_settings add column if not exists instagram_auto_publish integer not null default 0;
alter table public.user_settings add column if not exists instagram_share_to_feed integer not null default 1;
alter table public.user_settings add column if not exists instagram_hashtags text not null default '#gaming #gamingclips #reels #clipxai';
alter table public.user_settings add column if not exists storage_endpoint text not null default '';
alter table public.user_settings add column if not exists storage_region text not null default 'auto';
alter table public.user_settings add column if not exists storage_bucket text not null default '';
alter table public.user_settings add column if not exists storage_access_key_id text not null default '';
alter table public.user_settings add column if not exists storage_secret_access_key text not null default '';
alter table public.user_settings add column if not exists storage_prefix text not null default 'clipx';
alter table public.user_settings add column if not exists storage_public_base_url text not null default '';
alter table public.user_settings add column if not exists storage_force_path_style integer not null default 1;

-- -1 = follow the account default, 0 = never auto-publish, 1 = always
alter table public.streams add column if not exists auto_publish_enabled integer not null default -1
  check (auto_publish_enabled in (-1, 0, 1));

create table if not exists public.social_posts (
  id text primary key,
  user_id text references public.users(id) on delete cascade,
  clip_id text not null references public.clips(id) on delete cascade,
  platform text not null default 'instagram' check (platform in ('instagram')),
  mode text not null default 'manual' check (mode in ('manual', 'auto')),
  status text not null default 'queued'
    check (status in ('queued', 'hosting', 'creating', 'processing', 'published', 'failed')),
  caption text not null default '',
  media_key text not null default '',
  media_url_expires_at timestamptz,
  container_id text not null default '',
  remote_media_id text not null default '',
  permalink text not null default '',
  error text not null default '',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists idx_social_posts_clip on public.social_posts(clip_id);
create index if not exists idx_social_posts_status on public.social_posts(status, created_at desc);

-- Tokens live server-side only; row access follows clip ownership.
alter table public.social_posts enable row level security;

drop policy if exists social_posts_owner on public.social_posts;
create policy social_posts_owner on public.social_posts
  for all using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
