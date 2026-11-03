-- Migration 002 : liste des participants.
-- Les codes personnels sont générés par la base (jamais écrits dans le dépôt).
-- Idempotente : un participant déjà présent garde son code.
--
-- Pour ajouter quelqu’un plus tard, créez une migration 003_xxx.sql qui insère
-- la personne avec la position suivante ET démarre un tour neuf :
--   update public.game set round = round + 1;

insert into public.players (pos, name, code) values
  (1, 'Jewel',   substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (2, 'Marie',   substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (3, 'Eddy',    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (4, 'Martial', substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (5, 'Willy',   substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (6, 'Billy',   substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (7, 'Phares',  substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  (8, 'Alice',   substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
on conflict (name) do nothing;
