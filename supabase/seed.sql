/*
# Demo account seed

Run this ONCE against a fresh project, after the two schema migrations and
the security-hardening migration have been applied, to create four demo
accounts (admin / investigator / officer / analyst).

IMPORTANT — this only works against a project where you have direct SQL
access to the `auth` schema (e.g. local Supabase via `supabase db reset`, or
the SQL editor on a project you own with sufficient privileges). Hosted
Supabase projects generally expect you to create users via the Auth Admin
API (`supabase.auth.admin.createUser`) or the Dashboard's
Authentication > Users > "Add user" screen instead — the direct-insert
approach below is a common local-dev convenience, not a guaranteed-portable
technique. If it fails on your project, create the four users via the
Dashboard with these emails/passwords, then run just the second half of this
script (the `UPDATE profiles ...` statements) to assign roles, since
`handle_new_auth_user()` will already have created default 'analyst'
profile rows for them.

Passwords are for local/demo use only — rotate them (or better, delete these
accounts) before using this schema for anything real.

Note: MFA is real Supabase TOTP now (see AuthContext.tsx / Mfa.tsx). The
first time you log in as the admin demo account, the app will walk you
through enrolling a TOTP factor (scan the QR code with any authenticator
app) — there is no seed step for this, it happens interactively on login.
*/

-- Local/dev only. Hosted projects: create users in Dashboard > Authentication
-- > Users instead, then run only the UPDATE statements at the bottom.
create extension if not exists pgcrypto;

do $$
declare
  u record;
  v_id uuid;
begin
  for u in
    select * from (values
      ('admin@casevault.com',        'Admin@123',        'Sarah Mitchell'),
      ('investigator@casevault.com', 'Investigator@123', 'David Chen'),
      ('officer@casevault.com',      'Officer@123',      'Robert Taylor'),
      ('analyst@casevault.com',      'Analyst@123',      'Emily Watson')
    ) as t(email, pw, name)
  loop
    if not exists (select 1 from auth.users where email = u.email) then
      v_id := gen_random_uuid();
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) values (
        v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        u.email, crypt(u.pw, gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('name', u.name),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
      ) values (
        gen_random_uuid(), v_id, v_id::text,
        jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true),
        'email', now(), now(), now()
      );
    end if;
  end loop;
end $$;

-- handle_new_auth_user() auto-creates a profile with role='analyst'.
-- Promote the others (only an existing admin can do this from the app):
update profiles set role = 'admin',        name = 'Sarah Mitchell' where email = 'admin@casevault.com';
update profiles set role = 'investigator', name = 'David Chen'     where email = 'investigator@casevault.com';
update profiles set role = 'officer',      name = 'Robert Taylor'  where email = 'officer@casevault.com';
update profiles set role = 'analyst',      name = 'Emily Watson'   where email = 'analyst@casevault.com';
