-- Simulation : 300 tours complets, ordres de passage aléatoires.
-- Vérifie : personne ne se tire lui-même, aucun nom tiré deux fois, tour toujours
-- terminable, tirage idempotent (même résultat si on redemande), nouveau tour.
-- Tout est annulé à la fin (rollback).
\set ON_ERROR_STOP on
begin;

update public.game set round = round + 1;     -- tour neuf, quel que soit l’état de la base
create temp table codes on commit drop as select name, code from public.players;
grant select on codes to anon;

set local role anon;

do $$
declare
  n int := (select count(*) from codes);
  r int; g text; res text; again text; c text; seen text[]; ord text[];
begin
  if n < 2 then raise exception 'FAIL: il faut au moins 2 participants'; end if;

  -- nouveau tour refusé tant que le tour n’est pas terminé
  begin
    perform public.new_round((select name from codes limit 1), (select code from codes limit 1));
    raise exception 'FAIL: new_round accepté trop tôt';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  for r in 1..300 loop
    ord := array(select name from codes order by random());
    seen := '{}';
    foreach g in array ord loop
      c := (select code from codes where name = g);
      res := public.draw(g, c);
      if res = g then raise exception 'FAIL: % s’est tiré lui-même', g; end if;
      if res = any (seen) then raise exception 'FAIL: % tiré deux fois', res; end if;
      seen := seen || res;
      again := public.draw(g, c);
      if again <> res then raise exception 'FAIL: tirage non idempotent pour %', g; end if;
    end loop;
    if cardinality(seen) <> n then raise exception 'FAIL: tour incomplet'; end if;
    if json_array_length(public.get_status()->'drawn') <> n then raise exception 'FAIL: statut incohérent'; end if;
    perform public.new_round(ord[1], (select code from codes where name = ord[1]));
  end loop;

  raise notice 'OK simulation : 300 tours complets valides avec % participants', n;
end $$;

rollback;
