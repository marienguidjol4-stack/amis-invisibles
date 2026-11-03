# Sécurité

## Règles pour ce dépôt
- Seule la clé **publishable / anon** de Supabase peut être utilisée côté site. Jamais la clé `service_role` ni `sb_secret_…` : le build la refuse.
- Aucun code personnel, mot de passe de base ou jeton ne doit être commité ni affiché dans les journaux. La CI le vérifie (`scripts/check-secrets.sh`).
- `db/admin/show_codes.sql` et `rotate_code.sql` ne se lancent que dans le SQL Editor de Supabase.

## En cas de fuite
1. Clé secrète ou chaîne de connexion exposée : régénérez-la dans Supabase (*Project Settings > API* ou *Database*), puis mettez à jour les secrets GitHub.
2. Code personnel exposé : lancez `db/admin/rotate_code.sql` pour cette personne et envoyez-lui le nouveau code en privé.
3. Tirages compromis : lancez `db/admin/reset_round.sql` pour repartir sur un tour neuf.

## Signaler un problème
Ouvrez un signalement privé via l’onglet *Security* du dépôt (*Report a vulnerability*) ou contactez directement l’organisateur.
