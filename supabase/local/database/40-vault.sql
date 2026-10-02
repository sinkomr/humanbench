-- A shim of Supabase Vault (ROADMAP M2.0, M2.3). The real Vault encrypts with pgsodium and keeps
-- its root key outside the database. NONE of that is reproduced here: this shim only gives
-- migrations and tests the same SQL surface, so the M2.3 HMAC-key path (a SECURITY DEFINER
-- function reading the signing key from vault.decrypted_secrets, rotated by `kid`) runs the same
-- statements locally.
--
-- Mirrored: vault.secrets, vault.decrypted_secrets, vault.create_secret(), vault.update_secret(),
-- and the access rule that only `postgres` (with grant option, so it can pass access to a
-- restricted definer role) can use any of them: anon, authenticated and service_role cannot.
-- Stricter than needed on purpose: a test that passes here cannot depend on a grant the live
-- project may not give. Verify against the live project at M2.6 (ROADMAP).
--
-- The privilege rule of the real view is mirrored too, because the first version of M2.3 got it wrong
-- and no local test could tell. On Supabase the view decrypts through vault._crypto_aead_det_decrypt(),
-- a function that `REVOKE ALL ... FROM PUBLIC` leaves to the owner of the extension and the roles the
-- platform grants it to (`postgres`). PostgreSQL checks EXECUTE on a function called inside a view against
-- the role that RUNS the query, not the view's owner. So a role that was granted SELECT on the view and
-- nothing else (a definer role of the app's own) is refused with 42501 "permission denied for function";
-- only `postgres`, or a SECURITY DEFINER function it owns, can read a secret. Here the view calls
-- vault._crypto_aead_det_decrypt() (the shim's version of it, same name, EXECUTE for `postgres` alone), and
-- web/scripts/db/signing.db.test.ts holds a role with SELECT on the view alone to the refusal. hb.mac_sign
-- (20261003000100_save_signing.sql) is owned by `postgres` for that reason.
--
-- Not mirrored: pgsodium, key rotation of the Vault key, the `nonce`/`key_id` semantics. The
-- "encryption" key below is a public constant of this shim, NOT a secret; the secrets that tests
-- put in the Vault are fake values (CLAUDE.md: no real secrets in the repo).

create schema if not exists vault;

create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  key_id uuid,
  nonce bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function vault.create_secret(
  new_secret text,
  new_name text default null,
  new_description text default '',
  new_key_id uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into vault.secrets (secret, name, description, key_id)
  values (
    encode(extensions.pgp_sym_encrypt(new_secret, 'hb-vault-shim-public-constant-not-a-secret'), 'base64'),
    new_name,
    coalesce(new_description, ''),
    new_key_id
  )
  returning id into new_id;
  return new_id;
end
$$;

create function vault.update_secret(
  secret_id uuid,
  new_secret text default null,
  new_name text default null,
  new_description text default null,
  new_key_id uuid default null
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update vault.secrets
     set secret = case
           when new_secret is null then secret
           else encode(extensions.pgp_sym_encrypt(new_secret, 'hb-vault-shim-public-constant-not-a-secret'), 'base64')
         end,
         name = coalesce(new_name, name),
         description = coalesce(new_description, description),
         key_id = coalesce(new_key_id, key_id),
         updated_at = now()
   where id = secret_id;
end
$$;

-- The shim's counterpart of the Vault's decrypting function: callable by `postgres` only (see above).
create function vault._crypto_aead_det_decrypt(message text)
returns text
language sql immutable
set search_path = ''
as $$
  select extensions.pgp_sym_decrypt(pg_catalog.decode(message, 'base64'), 'hb-vault-shim-public-constant-not-a-secret')
$$;

create view vault.decrypted_secrets as
select
  s.id,
  s.name,
  s.description,
  s.secret,
  vault._crypto_aead_det_decrypt(s.secret) as decrypted_secret,
  s.key_id,
  s.nonce,
  s.created_at,
  s.updated_at
from vault.secrets s;

revoke all on table vault.secrets, vault.decrypted_secrets from public;
revoke all on function vault._crypto_aead_det_decrypt(text) from public;
revoke all on function vault.create_secret(text, text, text, uuid) from public;
revoke all on function vault.update_secret(uuid, text, text, text, uuid) from public;

grant usage on schema vault to postgres with grant option;
grant all on table vault.secrets to postgres with grant option;
grant select on table vault.decrypted_secrets to postgres with grant option;
grant execute on function vault._crypto_aead_det_decrypt(text) to postgres with grant option;
grant execute on function vault.create_secret(text, text, text, uuid) to postgres with grant option;
grant execute on function vault.update_secret(uuid, text, text, text, uuid) to postgres with grant option;
