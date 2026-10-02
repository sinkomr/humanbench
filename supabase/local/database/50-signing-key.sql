-- A throw-away signing key for the LOCAL database (ROADMAP M2.3, A6). On a Supabase project the HMAC key
-- of the saves is a Vault secret that the owner creates at M2.6; migrations never create one (CLAUDE.md: no real
-- secrets in the repo), so without this file a local database signs nothing and every session would come back
-- "unverified". The value is random per database and never written to any file: it exists only in the
-- throw-away cluster. Tests that need the unsigned path, a second key or a retired one create, rotate or delete
-- secrets named `save_hmac.<kid>` in their own clone.
--
-- The name matches `sig.current_kid` in the migrations ('k2026a'); a real project may use any kid it likes, as
-- long as the secret `save_hmac.<kid>` exists and app_config `sig.current_kid` names it.

select vault.create_secret(
  pg_catalog.encode(extensions.gen_random_bytes(32), 'hex'),
  'save_hmac.k2026a',
  'local throw-away signing key (random per database; not a secret of any real deployment)');
