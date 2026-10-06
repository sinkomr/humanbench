-- M2.1 (ROADMAP M2.1, A18; DESIGN §3 row 6, §7.8, R-11.1; UX-079, UX review D8, a provisional default): the decimal
-- comma in hb.parse_entry, the server's reader of a typed quantitative answer, as the app's parseEntry
-- (web/src/tasks/quant/numeric.ts) and the bank's hb.gen.quant.entry.parse_entry read it now.
--
-- One change to hb.parse_entry (20261001000500_private_functions.sql), nothing else; migrations.test.ts holds the body
-- to the earlier one with exactly this edit. After the plain integer or decimal and the leading-point decimal, digits,
-- one comma and one or two digits are a decimal comma: 3,5 is 3.5, 0,25 is 0.25, -1,5 is -1.5. A comma followed by
-- three digits is still the thousands form (1,533), which saved answers keep. The forms do not overlap, so every entry
-- this function read before reads the same, and no verdict recorded on the server changes. The app's entry box takes
-- a decimal comma since UX-079; without this change a served answer typed that way was read as no number and scored 0.
-- scoring.db.test.ts compares the function with the app's parseEntry on 2,000 random entries and the documented
-- examples (decimal commas included).

set local role hb_definer;

create or replace function hb.parse_entry(p_raw text, out o_num numeric, out o_den numeric)
language plpgsql immutable
set search_path = ''
as $$
declare
  c_ws constant text := E' \t\n\r\f\u000b\u00a0';
  s text;
  v_neg boolean;
  m text[];
begin
  o_num := null;
  o_den := null;
  if p_raw is null then
    return;
  end if;
  s := pg_catalog.replace(pg_catalog.btrim(p_raw, c_ws), E'\u2212', '-');
  if s = '' or pg_catalog.char_length(s) > 32 then
    return;
  end if;
  v_neg := pg_catalog.left(s, 1) = '-';
  if pg_catalog.left(s, 1) in ('+', '-') then
    s := pg_catalog.substr(s, 2);
  end if;
  if pg_catalog.left(s, 1) = '$' then
    s := pg_catalog.substr(s, 2);
  end if;
  if pg_catalog.right(s, 1) = '%' then
    s := pg_catalog.left(s, pg_catalog.char_length(s) - 1);
  end if;
  s := pg_catalog.btrim(s, c_ws);

  m := pg_catalog.regexp_match(s, '^([0-9]+)(?:\.([0-9]*))?$');
  if m is not null then
    o_num := (m[1] || coalesce(m[2], ''))::numeric;
    o_den := hb.pow10(pg_catalog.char_length(coalesce(m[2], '')));
  else
    m := pg_catalog.regexp_match(s, '^\.([0-9]+)$');
    if m is not null then
      o_num := m[1]::numeric;
      o_den := hb.pow10(pg_catalog.char_length(m[1]));
    else
      m := pg_catalog.regexp_match(s, '^([0-9]+),([0-9]{1,2})$');
      if m is not null then
        o_num := (m[1] || m[2])::numeric;
        o_den := hb.pow10(pg_catalog.char_length(m[2]));
      else
      m := pg_catalog.regexp_match(s, '^([0-9]{1,3}(?:,[0-9]{3})+)(?:\.([0-9]*))?$');
      if m is not null then
        o_num := (pg_catalog.replace(m[1], ',', '') || coalesce(m[2], ''))::numeric;
        o_den := hb.pow10(pg_catalog.char_length(coalesce(m[2], '')));
      else
        m := pg_catalog.regexp_match(s, E'^(?:([0-9]+)[ \t]+)?([0-9]+)[ \t]*/[ \t]*([0-9]+)$');
        if m is not null and m[3]::numeric <> 0 then
          o_den := m[3]::numeric;
          o_num := coalesce(m[1], '0')::numeric * o_den + m[2]::numeric;
        end if;
      end if;
      end if;
    end if;
  end if;
  if o_num is not null and v_neg then
    o_num := -o_num;
  end if;
end
$$;

reset role;
