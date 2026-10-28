-- Miles Traveled: database schema for Supabase.
-- Run this once in Supabase → SQL Editor, then run seed.sql.
-- Everyone whose email is on a row in "people" can sign in and see/edit the family's data.

create table if not exists people (
  id text primary key default substr(md5(random()::text), 1, 10),
  name text not null unique,
  kind text not null default 'person',          -- 'family' (has a profile + login), 'person', or 'group'
  email text,                                   -- family members sign in with this
  photo text,                                   -- storage path of their face
  color text,
  birthday date,
  notes text,
  created_at timestamptz default now()
);

create table if not exists homes (
  id text primary key default substr(md5(random()::text), 1, 10),
  person_id text references people(id) on delete cascade,
  from_date date not null,
  place text not null
);

create table if not exists countries (
  country text primary key,
  continent text
);

create table if not exists places (
  place text primary key,
  city text, state text,
  country text references countries(country) on update cascade,
  latlong text
);

create table if not exists airports (
  code text primary key,
  name text,
  place text references places(place) on update cascade,
  latlong text
);

create table if not exists trips (
  id text primary key default substr(md5(random()::text), 1, 10),
  name text not null,
  place text references places(place) on update cascade,
  start_date date, end_date date,
  date_confidence text default 'Exact',
  trip_type text, status text default 'Done',
  organization text, notes text, map_group text,
  other_cost numeric, photo text,
  created_at timestamptz default now()
);

create table if not exists legs (
  id text primary key default substr(md5(random()::text), 1, 10),
  trip_id text references trips(id) on delete set null,
  mode text not null default 'Flight',
  date date, end_date date,
  same_day boolean default false,
  from_text text, from_place text references places(place) on update cascade,
  to_text text, to_place text references places(place) on update cascade,
  from_airport text, to_airport text,
  miles numeric,
  people text[] default '{}',                   -- people.id of everyone on this leg
  date_confidence text, notes text, photo text, name text, map_group text,
  class text, cost numeric, flight_no text,
  created_at timestamptz default now()
);

create table if not exists stays (
  id text primary key default substr(md5(random()::text), 1, 10),
  trip_id text references trips(id) on delete set null,
  place text not null references places(place) on update cascade,
  arrive date not null,
  leave date not null,                           -- the morning you left (not a night)
  people text[] default '{}',
  confidence text, notes text, cost numeric,
  created_at timestamptz default now(),
  check (leave > arrive)
);

create table if not exists stories (
  id text primary key default substr(md5(random()::text), 1, 10),
  date date, title text, body text,
  trip_id text references trips(id) on delete set null,
  leg_id text references legs(id) on delete set null,
  stay_id text references stays(id) on delete set null,
  place text references places(place) on update cascade,
  people text[] default '{}',
  tags text,
  author text references people(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists photos (
  id text primary key default substr(md5(random()::text), 1, 10),
  path text not null,                            -- storage path in the "photos" bucket
  caption text, date date,
  trip_id text references trips(id) on delete set null,
  leg_id text references legs(id) on delete set null,
  stay_id text references stays(id) on delete set null,
  story_id text references stories(id) on delete set null,
  place text references places(place) on update cascade,
  people text[] default '{}',
  created_at timestamptz default now()
);

create table if not exists documents (
  id text primary key default substr(md5(random()::text), 1, 10),
  person_id text references people(id) on delete cascade,
  type text, name text, country text, expires date, notes text
);

create table if not exists wishes (
  id text primary key default substr(md5(random()::text), 1, 10),
  person_id text references people(id) on delete cascade,
  country text references countries(country) on update cascade,
  status text default 'Want to go'
);

create table if not exists packing (
  id text primary key default substr(md5(random()::text), 1, 10),
  trip_type text default 'Any', item text not null, category text
);

create table if not exists packing_checks (
  id text primary key default substr(md5(random()::text), 1, 10),
  trip_id text references trips(id) on delete cascade,
  item_id text references packing(id) on delete cascade
);

create table if not exists layers (
  id text primary key default substr(md5(random()::text), 1, 10),
  name text not null,
  geojson jsonb not null,                        -- Google Earth folders, simplified
  created_at timestamptz default now()
);

create table if not exists pins (
  id text primary key default substr(md5(random()::text), 1, 10),
  layer_id text references layers(id) on delete cascade,
  name text, folder text, subfolder text, latlong text, notes text,
  place text references places(place) on update cascade on delete set null,
  trip_id text references trips(id) on delete set null
);

-- ---------------------------------------------------------------- access
-- Only people listed with an email can read or write anything.
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

alter table people enable row level security;
drop policy if exists family_all on people;
create policy family_all on people for all to authenticated using (is_member()) with check (is_member());
alter table homes enable row level security;
drop policy if exists family_all on homes;
create policy family_all on homes for all to authenticated using (is_member()) with check (is_member());
alter table countries enable row level security;
drop policy if exists family_all on countries;
create policy family_all on countries for all to authenticated using (is_member()) with check (is_member());
alter table places enable row level security;
drop policy if exists family_all on places;
create policy family_all on places for all to authenticated using (is_member()) with check (is_member());
alter table airports enable row level security;
drop policy if exists family_all on airports;
create policy family_all on airports for all to authenticated using (is_member()) with check (is_member());
alter table trips enable row level security;
drop policy if exists family_all on trips;
create policy family_all on trips for all to authenticated using (is_member()) with check (is_member());
alter table legs enable row level security;
drop policy if exists family_all on legs;
create policy family_all on legs for all to authenticated using (is_member()) with check (is_member());
alter table stays enable row level security;
drop policy if exists family_all on stays;
create policy family_all on stays for all to authenticated using (is_member()) with check (is_member());
alter table stories enable row level security;
drop policy if exists family_all on stories;
create policy family_all on stories for all to authenticated using (is_member()) with check (is_member());
alter table photos enable row level security;
drop policy if exists family_all on photos;
create policy family_all on photos for all to authenticated using (is_member()) with check (is_member());
alter table documents enable row level security;
drop policy if exists family_all on documents;
create policy family_all on documents for all to authenticated using (is_member()) with check (is_member());
alter table wishes enable row level security;
drop policy if exists family_all on wishes;
create policy family_all on wishes for all to authenticated using (is_member()) with check (is_member());
alter table packing enable row level security;
drop policy if exists family_all on packing;
create policy family_all on packing for all to authenticated using (is_member()) with check (is_member());
alter table packing_checks enable row level security;
drop policy if exists family_all on packing_checks;
create policy family_all on packing_checks for all to authenticated using (is_member()) with check (is_member());
alter table layers enable row level security;
drop policy if exists family_all on layers;
create policy family_all on layers for all to authenticated using (is_member()) with check (is_member());
alter table pins enable row level security;
drop policy if exists family_all on pins;
create policy family_all on pins for all to authenticated using (is_member()) with check (is_member());

-- Private bucket for photos and faces.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists family_photos on storage.objects;
create policy family_photos on storage.objects for all to authenticated
  using (bucket_id = 'photos' and is_member()) with check (bucket_id = 'photos' and is_member());
