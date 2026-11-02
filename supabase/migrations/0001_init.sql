-- Recco — initial schema
-- Titles are cached from TMDB; attribution lives in `recommendations`.

create extension if not exists "pgcrypto";

-- Profiles ---------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  handle      text unique not null check (handle ~ '^[a-z0-9_]{2,24}$'),
  display_name text not null,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Titles (TMDB cache) ----------------------------------------------------
create type public.media_type as enum ('movie', 'tv');

create table public.titles (
  id           bigint generated always as identity primary key,
  tmdb_id      integer not null,
  media_type   public.media_type not null,
  imdb_id      text,
  letterboxd_slug text,
  title        text not null,
  original_title text,
  year         smallint,
  poster_path  text,
  updated_at   timestamptz not null default now(),
  unique (tmdb_id, media_type)
);
create index titles_imdb_idx on public.titles (imdb_id);
create index titles_lb_idx   on public.titles (letterboxd_slug);

-- Personal library (watchlist / watched) ---------------------------------
create type public.watch_status as enum ('to_watch', 'watched', 'dropped');

create table public.library_items (
  user_id     uuid not null references public.profiles on delete cascade,
  title_id    bigint not null references public.titles on delete cascade,
  status      public.watch_status not null default 'to_watch',
  rating      smallint check (rating between 1 and 10),
  reaction    text check (char_length(reaction) <= 280),
  told_by_text text,              -- "who told me" when not a Recco user
  added_at    timestamptz not null default now(),
  watched_at  timestamptz,
  primary key (user_id, title_id)
);

-- Lists ------------------------------------------------------------------
create table public.lists (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles on delete cascade,
  name        text not null,
  top_n       smallint check (top_n between 1 and 100),  -- null = unranked
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.list_items (
  list_id     uuid not null references public.lists on delete cascade,
  title_id    bigint not null references public.titles on delete cascade,
  position    smallint not null,
  note        text check (char_length(note) <= 140),
  primary key (list_id, title_id),
  unique (list_id, position) deferrable initially deferred
);

-- Shares (one fling / QR / link event) -----------------------------------
create type public.share_channel as enum ('nearby', 'qr', 'link');

create table public.shares (
  id          uuid primary key default gen_random_uuid(),
  list_id     uuid references public.lists on delete set null,
  sender_id   uuid references public.profiles on delete set null,
  channel     public.share_channel not null,
  created_at  timestamptz not null default now()
);

-- Recommendations: the attribution that survives -------------------------
create table public.recommendations (
  id            uuid primary key default gen_random_uuid(),
  title_id      bigint not null references public.titles on delete cascade,
  sender_id     uuid references public.profiles on delete set null,  -- null = "from a friend"
  recipient_id  uuid not null references public.profiles on delete cascade,
  share_id      uuid references public.shares on delete set null,
  via_id        uuid references public.recommendations on delete set null, -- forwarding chain
  note          text check (char_length(note) <= 140),
  created_at    timestamptz not null default now(),
  unique (title_id, sender_id, recipient_id)
);
create index reco_recipient_idx on public.recommendations (recipient_id, created_at desc);
create index reco_sender_idx    on public.recommendations (sender_id);

-- Hit rate view ----------------------------------------------------------
create view public.sender_hit_rate as
select r.sender_id,
       count(*)                                         as sent,
       count(*) filter (where li.status = 'watched')    as watched,
       round(avg(li.rating) filter (where li.status = 'watched'), 1) as avg_rating
from public.recommendations r
left join public.library_items li
  on li.user_id = r.recipient_id and li.title_id = r.title_id
where r.sender_id is not null
group by r.sender_id;

-- Row Level Security -----------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.titles          enable row level security;
alter table public.library_items   enable row level security;
alter table public.lists           enable row level security;
alter table public.list_items      enable row level security;
alter table public.shares          enable row level security;
alter table public.recommendations enable row level security;

create policy "profiles readable"   on public.profiles for select using (true);
create policy "own profile"         on public.profiles for update using (auth.uid() = id);

create policy "titles readable"     on public.titles for select using (true);
-- titles are inserted by the resolver Edge Function (service role)

create policy "own library"         on public.library_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "lists visible"       on public.lists for select
  using (is_public or owner_id = auth.uid());
create policy "own lists"           on public.lists for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "list items visible"  on public.list_items for select
  using (exists (select 1 from public.lists l
                 where l.id = list_id and (l.is_public or l.owner_id = auth.uid())));
create policy "own list items"      on public.list_items for all
  using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()));

create policy "own shares"          on public.shares for all
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

create policy "see my recos"        on public.recommendations for select
  using (recipient_id = auth.uid() or sender_id = auth.uid());
create policy "send recos"          on public.recommendations for insert
  with check (sender_id = auth.uid());
create policy "recipient removes"   on public.recommendations for delete
  using (recipient_id = auth.uid());
