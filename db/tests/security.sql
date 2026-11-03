-- Tests de sécurité : ce que la clé publique (rôle « anon ») peut et ne peut PAS faire.
-- Tout est annulé à la fin (rollback) : aucune donnée n’est modifiée.
\set ON_ERROR_STOP on
begin;

-- 1) L’état public ne doit jamais contenir un code personnel.
do $$
declare v text := public.get_status()::text;
begin
  if exists (select 1 from public.players where position(code in v) > 0) then
    raise exception 'FAIL: get_status() révèle un code personnel';
  end if;
end $$;

set local role anon;

do $$
declare t text;
begin
  -- 2) Aucune lecture directe des tables.
  foreach t in array array['players', 'draws', 'game', 'schema_migrations'] loop
    begin
      execute format('select * from public.%I', t);
      raise exception 'FAIL: anon peut lire public.%', t;
    exception when insufficient_privilege then null;
    end;
  end loop;

  -- 3) Aucune écriture directe.
  begin
    insert into public.draws (round, giver, receiver) values (1, 'Marie', 'Eddy');
    raise exception 'FAIL: anon peut insérer dans draws';
  exception when insufficient_privilege then null; end;

  begin
    update public.game set round = 99;
    raise exception 'FAIL: anon peut modifier game';
  exception when insufficient_privilege then null; end;

  -- 4) Les fonctions publiques restent appelables.
  perform public.get_status();

  -- 5) Un mauvais code est refusé (draw et new_round).
  begin
    perform public.draw('Marie', 'zzzzzzzz');
    raise exception 'FAIL: draw accepte un mauvais code';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  begin
    perform public.new_round('Marie', 'zzzzzzzz');
    raise exception 'FAIL: new_round accepte un mauvais code';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; end;

  raise notice 'OK sécurité : accès directs refusés, codes protégés';
end $$;

rollback;
