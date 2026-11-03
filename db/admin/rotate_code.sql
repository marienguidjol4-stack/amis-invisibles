-- Remplace le code d’un participant (code perdu ou compromis).
-- Changez le prénom, lancez dans Supabase > SQL Editor, puis envoyez le nouveau code en privé.
update public.players
   set code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
 where name = 'Marie'
returning name, code;
