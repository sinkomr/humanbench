-- M3.11 (ROADMAP M3.11; DESIGN §7.4, §10, §11.2, R-11.1; owner, 2026-10-13: "the site is live and i want any edits we
-- make to go live as soon as we push it. stop setting up artificial roadblocks"): which skills the server has
-- questions for, so the app plans and words a session from the bank as it is, with no build variable naming them.
--
-- Before this the app learned it from the repository variable HB_TEXT_AXES, read at build time: a skill whose
-- questions were loaded stayed out of every session until somebody changed the variable and rebuilt the site.
--
-- public.live_axes() returns {"axes": [<axis code>, ...]}: the axes that have at least one item a live slot of
-- hb.candidate_items could serve to a new session (status live, not practice-only, a key, and a parameter row for the
-- current param_version of a model the server scores, with the key that model scores against), in the canonical
-- axis order. Nothing else: no count, no item, no family, no parameter (R-11.1). It reads no session and takes no
-- argument, so it says the same to everybody, and it is what the item tables already imply for anyone who plays a
-- session. A skill whose items a given person has all seen is still listed; the session drops such a part without a
-- word when its first request answers no_items (web/src/session/run.ts).

grant create on schema public to hb_definer;
set local role hb_definer;

create function public.live_axes()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('axes', coalesce(pg_catalog.jsonb_agg(a.code order by a.ord), '[]'::jsonb))
    from pg_catalog.unnest(hb.axis_codes()) with ordinality a (code, ord)
   where exists (
     select 1
       from public.items i
       join public.item_families f on f.family_id = i.family_id
       join lateral (
         select ip.model, ip.a, ip.b, ip.c, ip.extra
           from public.item_parameters ip
          where ip.item_id = i.item_id and (hb.cfg_text('param_version', null) is null or ip.param_version = hb.cfg_text('param_version', null))
          order by ip.created_at desc
          limit 1) p on true
       join public.item_keys k on k.item_id = i.item_id
      where f.axis = a.code
        and i.status = 'live'
        and not f.practice_only
        and ((p.model in ('2pl', '2pl_testlet', '3pl') and p.a is not null and p.b is not null and (p.model <> '3pl' or (p.c is not null and p.c > 0 and p.c < 1)))
             or (p.model in ('gaussian', 'grm') and hb.continuous_params_ok(p.model, p.a, p.extra) and hb.key_fits_model(p.model, k.key))))
$$;

reset role;
revoke create on schema public from hb_definer;

revoke all on function public.live_axes() from public, anon, authenticated, service_role;
grant execute on function public.live_axes() to anon, authenticated;
