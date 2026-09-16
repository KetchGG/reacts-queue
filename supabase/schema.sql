-- Xaryu React Queue — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again: it only creates what is missing and replaces the functions.
--
-- Who can do what:
--   * Anyone with the website link can READ the lists, marks, mod picks and notes.
--   * Changing anything from the website requires the shared mod password
--     (checked inside the database, never sent to the browser as a hash).
--   * The daily GitHub job uses the Supabase secret key and can write everything.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables
create table if not exists public.days (
  date          date primary key,
  headline      text not null default '',
  coverage      text not null default '',
  generated_at  timestamptz not null default now(),
  items         jsonb not null default '[]'::jsonb
);

create table if not exists public.marks (
  date        date not null,
  item_id     text not null,
  state       text not null default '' check (state in ('', 'queued', 'watched', 'skip')),
  by_name     text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (date, item_id)
);

create table if not exists public.extras (
  id        uuid primary key default gen_random_uuid(),
  date      date not null,
  url       text not null check (url ~* '^https?://'),
  title     text not null default '',
  note      text not null default '',
  cat       text not null default 'other',
  by_name   text not null default '',
  added_at  timestamptz not null default now(),
  removed   boolean not null default false
);
create index if not exists extras_date_idx on public.extras (date);

-- Public settings the website shows (notes for the next run, source list).
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Private job state (channel ID cache, series trackers, seen news). Not readable from the website.
create table if not exists public.app_state (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- The mod password, stored only as a bcrypt hash. Not readable from the website.
create table if not exists public.mod_secret (
  id         int primary key default 1 check (id = 1),
  pass_hash  text not null
);

-- ---------------------------------------------------------------- grants + row level security
grant usage on schema public to anon, authenticated, service_role;

grant select on public.days, public.marks, public.extras, public.settings to anon, authenticated;
grant select, insert, update, delete on public.days, public.marks, public.extras, public.settings, public.app_state to service_role;
revoke all on public.app_state, public.mod_secret from anon, authenticated;
revoke all on public.mod_secret from service_role;

alter table public.days       enable row level security;
alter table public.marks      enable row level security;
alter table public.extras     enable row level security;
alter table public.settings   enable row level security;
alter table public.app_state  enable row level security;
alter table public.mod_secret enable row level security;

drop policy if exists "public read" on public.days;
create policy "public read" on public.days     for select to anon, authenticated using (true);
drop policy if exists "public read" on public.marks;
create policy "public read" on public.marks    for select to anon, authenticated using (true);
drop policy if exists "public read" on public.extras;
create policy "public read" on public.extras   for select to anon, authenticated using (true);
drop policy if exists "public read" on public.settings;
create policy "public read" on public.settings for select to anon, authenticated using (key in ('notes', 'sources'));
-- app_state and mod_secret get no policies: only the secret key (service_role) and the functions below reach them.

-- ---------------------------------------------------------------- mod actions (password checked)
create or replace function public._check_mod(p_pass text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare ok boolean;
begin
  select pass_hash = crypt(coalesce(p_pass, ''), pass_hash) into ok from public.mod_secret where id = 1;
  if ok is not true then
    perform pg_sleep(0.4);  -- slows down password guessing
    raise exception 'wrong mod password' using errcode = '28P01';
  end if;
end $$;

create or replace function public.verify_mod(p_pass text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._check_mod(p_pass);
  return true;
end $$;

create or replace function public.set_mark(p_pass text, p_date date, p_item text, p_state text, p_by text default '')
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._check_mod(p_pass);
  if p_state not in ('', 'queued', 'watched', 'skip') then
    raise exception 'unknown state %', p_state using errcode = '22023';
  end if;
  insert into public.marks (date, item_id, state, by_name, updated_at)
  values (p_date, left(p_item, 80), p_state, left(coalesce(p_by, ''), 40), now())
  on conflict (date, item_id) do update
    set state = excluded.state, by_name = excluded.by_name, updated_at = now();
end $$;

create or replace function public.add_extra(p_pass text, p_date date, p_url text, p_title text, p_note text, p_cat text, p_by text default '')
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare new_id uuid;
begin
  perform public._check_mod(p_pass);
  if p_url !~* '^https?://' or length(p_url) > 2000 then
    raise exception 'link must start with http:// or https://' using errcode = '22023';
  end if;
  if (select count(*) from public.extras where date = p_date and not removed) >= 100 then
    raise exception 'this day already has 100 mod picks' using errcode = '54000';
  end if;
  insert into public.extras (date, url, title, note, cat, by_name)
  values (p_date, p_url, left(coalesce(p_title, ''), 200), left(coalesce(p_note, ''), 300),
          left(coalesce(nullif(p_cat, ''), 'other'), 20), left(coalesce(p_by, ''), 40))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.remove_extra(p_pass text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._check_mod(p_pass);
  update public.extras set removed = true where id = p_id;
end $$;

create or replace function public.set_notes(p_pass text, p_text text, p_by text default '')
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public._check_mod(p_pass);
  insert into public.settings (key, value, updated_at)
  values ('notes', jsonb_build_object('text', left(coalesce(p_text, ''), 4000), 'by', left(coalesce(p_by, ''), 40)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Owner only: run in the SQL editor to set or change the mod password.
--   select public.set_mod_password('pick-a-long-passphrase');
create or replace function public.set_mod_password(p_new text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_new, '')) < 10 then
    raise exception 'use at least 10 characters';
  end if;
  insert into public.mod_secret (id, pass_hash) values (1, crypt(p_new, gen_salt('bf', 10)))
  on conflict (id) do update set pass_hash = excluded.pass_hash;
end $$;

revoke all on function public._check_mod(text) from public, anon, authenticated;
revoke all on function public.set_mod_password(text) from public, anon, authenticated, service_role;
revoke all on function public.verify_mod(text), public.set_mark(text, date, text, text, text),
  public.add_extra(text, date, text, text, text, text, text), public.remove_extra(text, uuid),
  public.set_notes(text, text, text) from public;
grant execute on function public.verify_mod(text), public.set_mark(text, date, text, text, text),
  public.add_extra(text, date, text, text, text, text, text), public.remove_extra(text, uuid),
  public.set_notes(text, text, text) to anon, authenticated;

-- Starter rows
insert into public.settings (key, value) values ('notes', '{"text": ""}') on conflict do nothing;
