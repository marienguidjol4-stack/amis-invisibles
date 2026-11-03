-- Migration 001 : schéma, sécurité (RLS) et fonctions de tirage.
-- Idempotente : peut être rejouée sans danger.
-- Ne contient volontairement aucun SELECT : les journaux de CI sont publics.

-- 1) Tables ------------------------------------------------------------

create table if not exists public.players (
  pos  int  not null,
  name text primary key,
  code text not null            -- code personnel de 8 caractères
);

create table if not exists public.game (
  id    int primary key default 1 check (id = 1),
  round int not null default 1   -- numéro du tour en cours
);
insert into public.game (id, round) values (1, 1) on conflict (id) do nothing;

create table if not exists public.draws (
  round    int  not null,
  giver    text not null references public.players (name),
  receiver text not null references public.players (name),
  primary key (round, giver),    -- une seule personne tirée par donneur et par tour
  unique (round, receiver),      -- un nom ne peut être tiré qu’une fois par tour
  check (giver <> receiver)      -- personne ne se tire lui-même
);

-- 2) Sécurité : aucun accès direct aux tables depuis le site -------------
--    RLS activée sans aucune policy = tout est refusé pour la clé publique.
--    Le site ne peut appeler que les 3 fonctions définies plus bas.

alter table public.players enable row level security;
alter table public.game    enable row level security;
alter table public.draws   enable row level security;

revoke all on public.players, public.game, public.draws from anon, authenticated;

-- 3) Fonction publique : état du tour (noms + qui a déjà tiré) ------------
--    Ne révèle jamais qui a tiré qui.

create or replace function public.get_status()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'round',   g.round,
    'players', (select coalesce(json_agg(p.name order by p.pos), '[]'::json) from public.players p),
    'drawn',   (select coalesce(json_agg(d.giver order by d.giver), '[]'::json)
                  from public.draws d where d.round = g.round)
  )
  from public.game g;
$$;

-- 4) Fonction de tirage : protégée par le code personnel ------------------
--    Renvoie le nom tiré. Si la personne a déjà tiré dans ce tour, renvoie
--    le même nom (elle peut donc revoir son tirage avec son code).

create or replace function public.draw(p_name text, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round    int;
  v_existing text;
  v_free     text[];   -- noms pas encore tirés dans ce tour
  v_left     text[];   -- autres personnes qui n’ont pas encore tiré
  v_cands    text[];   -- noms que cette personne a le droit de tirer
  v_receiver text;
begin
  if not exists (select 1 from public.players where name = p_name and code = p_code) then
    perform pg_sleep(1);                       -- ralentit les essais de codes
    raise exception 'Nom ou code incorrect';
  end if;

  -- Verrou : un seul tirage à la fois, même si tout le monde clique ensemble.
  perform 1 from public.game where id = 1 for update;
  select round into v_round from public.game where id = 1;

  select receiver into v_existing
    from public.draws where round = v_round and giver = p_name;
  if v_existing is not null then
    return v_existing;
  end if;

  select coalesce(array_agg(p.name), '{}') into v_free
    from public.players p
   where not exists (select 1 from public.draws d where d.round = v_round and d.receiver = p.name);

  select coalesce(array_agg(p.name), '{}') into v_left
    from public.players p
   where p.name <> p_name
     and not exists (select 1 from public.draws d where d.round = v_round and d.giver = p.name);

  v_cands := array(select x from unnest(v_free) x where x <> p_name);

  -- Évite l’impasse finale : s’il ne reste qu’une autre personne à tirer et que
  -- son propre nom est encore libre, ce nom doit lui échapper (donc me revenir).
  if array_length(v_left, 1) = 1 and v_left[1] = any (v_free) then
    v_cands := array[v_left[1]];
  end if;

  if coalesce(array_length(v_cands, 1), 0) = 0 then
    raise exception 'Aucun nom disponible : recommencez un nouveau tirage';
  end if;

  select x into v_receiver from unnest(v_cands) x order by random() limit 1;

  insert into public.draws (round, giver, receiver) values (v_round, p_name, v_receiver);
  return v_receiver;
end;
$$;

-- 5) Nouveau tour : possible seulement quand tout le monde a tiré ---------

create or replace function public.new_round(p_name text, p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_total int;
  v_done  int;
begin
  if not exists (select 1 from public.players where name = p_name and code = p_code) then
    perform pg_sleep(1);
    raise exception 'Nom ou code incorrect';
  end if;

  perform 1 from public.game where id = 1 for update;
  select round into v_round from public.game where id = 1;
  select count(*) into v_total from public.players;
  select count(*) into v_done  from public.draws where round = v_round;

  if v_done < v_total then
    raise exception 'Le tour en cours n’est pas terminé';
  end if;

  update public.game set round = round + 1 where id = 1;
end;
$$;

-- 6) Droits : seules ces 3 fonctions sont appelables depuis le site ------

revoke all on function public.get_status()                 from public;
revoke all on function public.draw(text, text)             from public;
revoke all on function public.new_round(text, text)        from public;
grant execute on function public.get_status()              to anon, authenticated;
grant execute on function public.draw(text, text)          to anon, authenticated;
grant execute on function public.new_round(text, text)     to anon, authenticated;
