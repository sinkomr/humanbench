-- M2.1 (ROADMAP M2.1; DESIGN §8, §11.2, §12, §13, R-12.1; ROADMAP A16, AI.26): the session and
-- person-side tables: sessions, responses, flags (§12), plus the exposure log, the exposure
-- counters, the rate-limit tables, the survey, the server mirror and the recovery-phrase words.
--
-- Privacy (DESIGN §13): no IP address is stored in any app table. The rate table holds a hash of
-- (IP + a salt that changes daily) with a count, and is purged after 48 hours. The survey holds no
-- anon_id, only a session_id (a cascade deletes it with the session). The only free text a person can
-- put in is a typed answer (responses.response, as in the save file) and a "Report a problem" note
-- (flags.detail, 500 characters at most; none for the notes category).
--
-- AI.26 / R-17.1 / R-17.12: every client-supplied JSON column carries a CHECK that no object inside
-- it has a `brief_prefs` key, so the notes settings cannot be stored even by a buggy RPC. There is
-- no notes table.
--
-- Access: as in the bank-tables migration. RLS on, no grant and no policy for anon or authenticated;
-- hb_definer reads and writes what each RPC needs through policies written for it; service_role gets
-- read access for the nightly job (M2.5, M4.10).

-- ------------------------------------------------------------------------------------- sessions
create table public.sessions (
  session_id text primary key check (session_id ~ '^s_[0-9A-Za-z]{8,32}$'),
  anon_id text not null check (anon_id ~ '^hb_[0-9A-Za-z]{16,17}$'),
  -- SHA-256 of the opaque session token (128 random bits, shown to the client once). The token
  -- itself is never stored, so a database backup holds no usable credential.
  token_hash bytea not null unique,
  bank_version text,
  param_version text,
  device jsonb not null check (hb.no_brief_prefs(device)),
  flags jsonb not null default '{}' check (hb.no_brief_prefs(flags)),
  -- Per-session server state: the seen lists from the save the session started with now; the
  -- per-axis EAP grids from M2.2.
  state jsonb not null default '{}' check (hb.no_brief_prefs(state)),
  n_served int not null default 0 check (n_served >= 0),
  n_answered int not null default 0 check (n_answered >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  calibration_eligible boolean not null default false,
  check (n_answered <= n_served)
);
create index sessions_anon_idx on public.sessions (anon_id);
create index sessions_started_idx on public.sessions (started_at);

-- --------------------------------------------------------------------------------- exposure_log
-- Every item served to a session, in order. A row without a response is a pending item (a reload
-- gets the same item back). Keeps the sibling group so exclusion needs no join.
create table public.exposure_log (
  session_id text not null references public.sessions (session_id) on delete cascade,
  seq int not null check (seq >= 1),
  item_id text not null references public.items (item_id),
  family_id text not null,
  sibling_group text not null,
  pretest boolean not null default false,
  served_at timestamptz not null default now(),
  primary key (session_id, seq),
  unique (session_id, item_id)
);
create index exposure_log_item_idx on public.exposure_log (item_id);

-- ------------------------------------------------------------------------------------ responses
create table public.responses (
  session_id text not null references public.sessions (session_id) on delete cascade,
  seq int not null,
  item_id text not null references public.items (item_id),
  response jsonb check (hb.no_brief_prefs(response)),
  correct smallint check (correct in (0, 1)),
  score real,
  rt_ms int check (rt_ms >= 0),
  confidence smallint check (confidence between 0 and 100),
  pretest boolean not null default false,
  client_flags jsonb not null default '{}' check (hb.no_brief_prefs(client_flags)),
  created_at timestamptz not null default now(),
  primary key (session_id, seq),
  unique (session_id, item_id),
  foreign key (session_id, seq) references public.exposure_log (session_id, seq) on delete cascade
);
create index responses_item_idx on public.responses (item_id);

-- ------------------------------------------------------------------------------- item_exposure
-- How many sessions have been served each item: the numerator of the 0.25 exposure cap (M2.2).
create table public.item_exposure (
  item_id text primary key references public.items (item_id) on delete cascade,
  n_sessions bigint not null default 0 check (n_sessions >= 0)
);

-- ---------------------------------------------------------------------------------------- flags
-- Reports (source 'user') and the nightly job's findings (source 'auto'). A user report is one of
-- the five item categories of DESIGN §4.5, or the separate non-item category "someone asked me for
-- my notes" (ROADMAP AI.26), which carries no item and no text and never counts toward quarantine.
create table public.flags (
  flag_id bigserial primary key,
  item_id text references public.items (item_id),
  session_id text references public.sessions (session_id) on delete cascade,
  kind text not null,
  detail text check (char_length(detail) <= 500),
  source text not null check (source in ('user', 'auto')),
  created_at timestamptz not null default now(),
  resolved boolean not null default false,
  check (source <> 'user' or kind in ('wrong_key', 'ambiguous', 'typo', 'offensive', 'broken', 'notes_requested')),
  check (source <> 'user' or session_id is not null),
  check (kind <> 'notes_requested' or (source = 'user' and item_id is null and detail is null)),
  check (source <> 'user' or kind = 'notes_requested' or item_id is not null)
);
create index flags_item_idx on public.flags (item_id) where item_id is not null;
create unique index flags_user_item_once on public.flags (session_id, item_id, kind)
  where source = 'user' and item_id is not null;
create unique index flags_user_notes_once on public.flags (session_id)
  where source = 'user' and kind = 'notes_requested';

-- ---------------------------------------------------------------------------------------- rate
-- DESIGN §11.2: counts per hashed(IP + daily salt). key_hash is a hash, never an address; the salt
-- table is purged with it, so yesterday's hashes cannot be recomputed or linked to today's.
create table public.rate_limits (
  kind text not null,
  key_hash text not null,
  day date not null,
  n int not null default 0,
  primary key (kind, key_hash, day)
);
create index rate_limits_day_idx on public.rate_limits (day);

create table public.rate_salts (
  day date primary key,
  salt bytea not null
);

-- --------------------------------------------------------------------------------------- survey
-- DESIGN §13: optional, voluntary, stored apart from the session row, for DIF only. No anon_id.
create table public.survey (
  session_id text primary key references public.sessions (session_id) on delete cascade,
  age_band text check (age_band in ('18-24', '25-34', '35-44', '45-54', '55-64', '65+')),
  english_first boolean,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------------------- mirror
-- DESIGN §8 "Optional server mirror": the save keyed by anon_id, retrieved with the recovery phrase.
-- Only SHA-256(phrase) is stored. The blob never holds `brief_prefs` (AI.26).
create table public.mirror (
  anon_id text primary key check (anon_id ~ '^hb_[0-9A-Za-z]{16,17}$'),
  phrase_hash bytea not null,
  blob jsonb not null check (pg_catalog.jsonb_typeof(blob) = 'object' and hb.no_brief_prefs(blob)),
  size_bytes int not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The 1,024 words of the recovery phrase (the next migration fills it).
create table public.recovery_words (
  idx smallint primary key check (idx between 0 and 1023),
  word text not null unique check (word ~ '^[a-z]{4,8}$')
);

-- ------------------------------------------------------------------------------ access control
alter table public.sessions enable row level security;
alter table public.exposure_log enable row level security;
alter table public.responses enable row level security;
alter table public.item_exposure enable row level security;
alter table public.flags enable row level security;
alter table public.rate_limits enable row level security;
alter table public.rate_salts enable row level security;
alter table public.survey enable row level security;
alter table public.mirror enable row level security;
alter table public.recovery_words enable row level security;

revoke all on table public.sessions, public.exposure_log, public.responses, public.item_exposure, public.flags,
  public.rate_limits, public.rate_salts, public.survey, public.mirror, public.recovery_words
  from public, anon, authenticated, service_role;
revoke all on sequence public.flags_flag_id_seq from public, anon, authenticated, service_role;

-- What each RPC does, and no more.
grant select, insert, update, delete on public.sessions to hb_definer;
grant select, insert on public.exposure_log to hb_definer;
grant select, insert on public.responses to hb_definer;
grant select, insert, update on public.item_exposure to hb_definer;
grant select, insert on public.flags to hb_definer;
grant select, insert, update, delete on public.rate_limits to hb_definer;
grant select, insert, delete on public.rate_salts to hb_definer;
grant select, insert, update on public.survey to hb_definer;
grant select, insert, update, delete on public.mirror to hb_definer;
grant select on public.recovery_words to hb_definer;
grant usage on sequence public.flags_flag_id_seq to hb_definer;

create policy hb_definer_all on public.sessions for all to hb_definer using (true) with check (true);
create policy hb_definer_read on public.exposure_log for select to hb_definer using (true);
create policy hb_definer_insert on public.exposure_log for insert to hb_definer with check (true);
create policy hb_definer_read on public.responses for select to hb_definer using (true);
create policy hb_definer_insert on public.responses for insert to hb_definer with check (true);
create policy hb_definer_all on public.item_exposure for all to hb_definer using (true) with check (true);
create policy hb_definer_read on public.flags for select to hb_definer using (true);
create policy hb_definer_insert on public.flags for insert to hb_definer with check (true);
create policy hb_definer_all on public.rate_limits for all to hb_definer using (true) with check (true);
create policy hb_definer_all on public.rate_salts for all to hb_definer using (true) with check (true);
create policy hb_definer_all on public.survey for all to hb_definer using (true) with check (true);
create policy hb_definer_all on public.mirror for all to hb_definer using (true) with check (true);
create policy hb_definer_read on public.recovery_words for select to hb_definer using (true);

-- The nightly job (calibrate, backup, archive; M2.5, M4.10) reads what happened and writes flags
-- and the calibration log. It does not read the mirror or the rate tables.
grant select on public.sessions, public.exposure_log, public.responses, public.item_exposure, public.survey to service_role;
grant select, insert, update on public.flags to service_role;
grant usage on sequence public.flags_flag_id_seq to service_role;
