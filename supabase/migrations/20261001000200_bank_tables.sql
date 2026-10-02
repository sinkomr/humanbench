-- M2.1 (ROADMAP M2.1; DESIGN §12, R-11.1, R-12.1; ROADMAP A11, A18, A23, AI.2): the item bank
-- tables and the settings table.
--
-- DESIGN §12 columns, plus what the bank's row models name for this migration (hb.items.rows):
--   item_families  sibling_group (not null, = family_id unless the family groups siblings, A11/A18),
--                  topic, curriculum_level, notation, ladder_probe, practice_only (AI.2/A23)
--   items          server_tags (server-only A23 tags: question_type, inference_steps)
-- Deviations from §12, all tightening or lossless: item_parameters.a/b/c/se_b are double
-- precision (real would round the bank's values at 1e-7 and show up in the M2.2 golden parity),
-- and the not-null / check constraints below.
--
-- Access (R-12.1): every table has RLS enabled and NO policy for anon or authenticated, and no grant
-- to them either. hb_definer (the owner of the RPCs) reads through a select-only policy;
-- service_role (the bank pipeline, ROADMAP M2.5) writes the bank tables and bypasses RLS.
--
-- No data is inserted into item_keys here or anywhere in this repo (CLAUDE.md). The only rows are
-- app_config's settings.

-- ---------------------------------------------------------------------------------- app_config
create table public.app_config (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);
comment on table public.app_config is
  'Tunables of the RPCs (limits, retest priors, the current bank_version / param_version). Read by hb.cfg(); written by the bank pipeline and by hand, never by an API role.';

-- ------------------------------------------------------------------------------ item_families
create table public.item_families (
  family_id text primary key check (family_id ~ '^f:[a-z][a-z0-9_]{0,23}:[0-9a-f]{12}$'),
  -- The near-isomorph group a session shows at most once (A11/A18): the family_id itself, or
  -- g:<family>:<label>. Filled from family_id by a trigger when omitted ("default family_id";
  -- a column default cannot read another column).
  sibling_group text not null check (sibling_group ~ '^(f:[a-z][a-z0-9_]{0,23}:[0-9a-f]{12}|g:[a-z][a-z0-9_]{0,23}:[a-z0-9_]{1,48})$'),
  axis text not null check (axis in ('MAT','LR','LG','RC','VOC','QR','SPA','WM','RT','PS','FER','CAL','KST','KHU','KAP','EMO','CRE')),
  facet text,
  generator text,
  generator_version text,
  gold_tier char(1) check (gold_tier in ('a','b','c')),
  difficulty_stratum int check (difficulty_stratum between 1 and 6),
  source jsonb not null,
  license text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  -- AI.2 / A23 tags. Public-safe and family-level. curriculum_level is never rendered into notes
  -- (R-17.3); topic is the id as stored (the bank resolves retired ids through its alias map).
  topic text check (topic ~ '^[a-z]+(/[a-z0-9_]+)+$'),
  curriculum_level text check (curriculum_level ~ '^[a-z_]+$'),
  notation text[] not null default '{}',
  ladder_probe boolean not null default false,
  practice_only boolean not null default false,
  check (not (ladder_probe and practice_only))
);
create index item_families_axis_idx on public.item_families (axis);
create index item_families_sibling_group_idx on public.item_families (sibling_group);

-- ----------------------------------------------------------------------------------------- items
create table public.items (
  item_id text primary key check (item_id ~ '^i:[a-z][a-z0-9_]{0,23}:[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}:.+$'),
  family_id text not null references public.item_families (family_id),
  item_type text not null,
  -- Exactly what a client renders: stem, media (the render spec) and options. R-11.1: no key,
  -- rationale or tolerance field anywhere inside (checked here and again by the bank's G1).
  payload jsonb not null check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and (payload - 'stem' - 'media' - 'options') = '{}'::jsonb
    and hb.no_key_fields(payload)
  ),
  time_limit_s int check (time_limit_s > 0),
  status text not null default 'draft' check (status in ('draft','review','pretest','live','quarantined','retired')),
  verification jsonb not null,
  provenance jsonb not null,
  server_tags jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index items_family_idx on public.items (family_id);
create index items_live_idx on public.items (family_id) where status = 'live';

-- ------------------------------------------------------------------------------------ item_keys
create table public.item_keys (
  item_id text primary key references public.items (item_id) on delete cascade,
  key jsonb not null,
  tolerance jsonb,
  option_weights jsonb,
  rationale jsonb
);

-- ------------------------------------------------------------------------------ item_parameters
create table public.item_parameters (
  item_id text not null references public.items (item_id) on delete cascade,
  param_version text not null,
  model text not null check (model in ('2pl','2pl_testlet','3pl','grm','gaussian')),
  a double precision,
  b double precision,
  c double precision,
  extra jsonb not null default '{}',
  n_resp int not null default 0 check (n_resp >= 0),
  se_b double precision,
  prior_source text,
  created_at timestamptz not null default now(),
  primary key (item_id, param_version),
  check (model not in ('2pl','2pl_testlet','3pl') or (a is not null and b is not null)),
  check (model <> '3pl' or (c is not null and c > 0 and c < 1))
);

-- ------------------------------------------------------------------------------ calibration_runs
create table public.calibration_runs (
  run_id bigserial primary key,
  param_version text,
  started_at timestamptz,
  finished_at timestamptz,
  n_responses int,
  anchor_drift real,
  sigma jsonb,
  report jsonb,
  git_sha text
);

-- sibling_group defaults to family_id.
grant create on schema public to hb_definer;
set local role hb_definer;

create function hb.family_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sibling_group is null then
    new.sibling_group := new.family_id;
  end if;
  return new;
end
$$;

reset role;
revoke create on schema public from hb_definer;

create trigger item_families_defaults
  before insert or update on public.item_families
  for each row execute function hb.family_defaults();

-- ------------------------------------------------------------------------------ access control
alter table public.app_config enable row level security;
alter table public.item_families enable row level security;
alter table public.items enable row level security;
alter table public.item_keys enable row level security;
alter table public.item_parameters enable row level security;
alter table public.calibration_runs enable row level security;

revoke all on table public.app_config, public.item_families, public.items, public.item_keys,
  public.item_parameters, public.calibration_runs from public, anon, authenticated, service_role;
revoke all on sequence public.calibration_runs_run_id_seq from public, anon, authenticated, service_role;

-- The RPCs read the bank (select only) through these policies; they bypass nothing.
grant select on public.app_config, public.item_families, public.items, public.item_keys, public.item_parameters to hb_definer;
create policy hb_definer_read on public.app_config for select to hb_definer using (true);
create policy hb_definer_read on public.item_families for select to hb_definer using (true);
create policy hb_definer_read on public.items for select to hb_definer using (true);
create policy hb_definer_read on public.item_keys for select to hb_definer using (true);
create policy hb_definer_read on public.item_parameters for select to hb_definer using (true);

-- The bank pipeline (hb load push, hb calibrate; M2.5, M4.10) uses service_role: it writes the
-- bank tables and the calibration log. Not deletes: items are retired, not removed.
grant select, insert, update on public.app_config, public.item_families, public.items, public.item_keys,
  public.item_parameters, public.calibration_runs to service_role;
grant usage on sequence public.calibration_runs_run_id_seq to service_role;

-- --------------------------------------------------------------------------------- the settings
-- Limits and priors. Values are not secrets. bank_version and param_version are absent until the
-- bank pipeline writes them (a session then records null).
insert into public.app_config (key, value, description) values
  ('rate.sessions_per_day',      '5',     'start_session calls per hashed(IP + daily salt) per UTC day (DESIGN §11.2)'),
  ('rate.mirror_puts_per_day',   '30',    'mirror_put calls per hashed IP per UTC day'),
  ('rate.mirror_gets_per_day',   '60',    'mirror_get calls per hashed IP per UTC day'),
  ('rate.deletes_per_day',       '10',    'delete_my_data calls per hashed IP per UTC day'),
  ('rate.rescores_per_day',      '20',    'rescore calls per hashed IP per UTC day: 5 sessions a day and a few views of each result fit with room to spare; every call is a measurement a script could compare with another (rescore.*)'),
  ('rate.rescores_per_anon_day', '10',    'rescore calls per anon_id per UTC day, counted only when the save holds a session issued to that anon_id (so a stranger who knows an id cannot use up its calls); stops a script that changes its address between calls'),
  ('rate.phrase_failures_per_ip_day', '60', 'failed recovery-phrase checks (mirror_put, mirror_get, delete_my_data) per hashed IP per UTC day'),
  ('rate.ip_header',             '"x-forwarded-for"', 'request header that carries the client address; verify against the hosted project (M2.6)'),
  ('rate.ip_hop',                '-1',    'which comma-separated entry of that header is the client: -1 = last (the one a proxy appended; cannot be forged), -2 = the one before it, 1 = first (forgeable unless the gateway overwrites the header); verify at M2.6'),
  ('session.max_items',          '200',   'items one session may be served (DESIGN §11.2)'),
  ('session.min_avg_ms',         '2000',  'a session averaging less than this per answered item is blocked (DESIGN §11.2)'),
  ('session.min_avg_after',      '10',    'answered items before the average is checked'),
  ('session.ttl_minutes',        '720',   'an unfinished session token stops working after this long'),
  ('session.post_finish_minutes','1440',  'a finished session token still works for survey, report and mirror this long'),
  ('session.max_reports',        '20',    'report_problem calls per session'),
  ('payload.max_response_bytes', '65536', 'largest accepted response / client flags payload per submit'),
  ('save.max_seen',              '20000', 'largest seen_items / seen_families list accepted from a save'),
  ('save.max_bytes',             '2097152','largest save (as JSON text) accepted by start_session, rescore and delete_my_data'),
  ('mirror.max_bytes',           '524288','largest save the server mirror stores'),
  ('mirror.max_rows',            '5000',  'most mirrored saves; further creates are refused until raised'),
  ('rescore.max_sessions',       '40',    'most sessions in a save passed to rescore'),
  ('rescore.min_axis_items',     '5',     'a session''s answers on an axis count in rescore only if that session holds at least this many scored answers on the axis (answers outside the item''s answer space are not answers), so no session adds a single answer to a score; an axis is returned if one session counts (R-11.1, DESIGN §10). 5 is also the count at which the app shows a facet (A12, viz/facets.ts FACET_MIN_ITEMS)'),
  ('rescore.min_facet_items',    '5',     'the same for a facet: a session''s answers on a facet count for the facet only if that session holds at least this many on it, and a facet is returned only under an axis that is (A12)'),
  ('rescore.mean_step',          '0.1',   'rescore rounds each posterior mean to a multiple of this (SD units); 0 = exact, for the parity tests only. Well under the posterior sd (0.3 to 0.7 after a session)'),
  ('rescore.sd_step',            '0.05',  'rescore rounds each posterior sd UP to a multiple of this (uncertainty is never understated); 0 = exact, for the parity tests only'),
  ('retest.tau',                 '1.2',   'DESIGN §7.8 time constant of the practice curve'),
  ('retest.rho_max',
   '{"MAT":0.45,"LR":0.45,"LG":0.45,"RC":0.25,"VOC":0.25,"QR":0.45,"SPA":0.45,"WM":0.45,"RT":0.45,"PS":0.45,"FER":0.25,"CAL":0.25,"KST":0.25,"KHU":0.25,"KAP":0.25,"EMO":0.25,"CRE":0.25}',
   'DESIGN §7.8 practice-gain plateau per axis (SD units); equals RHO_MAX_PRIOR in web/src/engine/retest.ts until M4.7 estimates it');
