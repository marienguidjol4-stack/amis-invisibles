-- À lancer UNIQUEMENT dans Supabase > SQL Editor (jamais en CI : les journaux
-- des dépôts publics sont lisibles par tout le monde).
select pos, name, code from public.players order by pos;
