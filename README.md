# Amis invisibles

Tirage au sort d’amis invisibles pour un petit groupe, utilisable depuis chaque téléphone.
Chacun choisit son nom, entre son code personnel et découvre à qui offrir un cadeau.
Personne ne peut se tirer lui-même, un nom n’est tiré qu’une fois par tour, et le tour
suivant remet tous les noms en jeu.

```mermaid
flowchart LR
  A["Amis (navigateur)"] -->|"HTTPS"| P["GitHub Pages (site statique)"]
  A -->|"3 fonctions RPC : get_status, draw, new_round"| S[("Supabase : Postgres + RLS")]
  G["GitHub Actions"] -->|"tests, build, déploiement"| P
  G -.->|"migrations (optionnel)"| S
```

## Contenu du dépôt

```
web/                  site statique (index.html, style.css, app.js)
db/migrations/        schéma, sécurité et fonctions (001), participants (002)
db/admin/             scripts à lancer à la main dans le SQL Editor (codes, nouveau tour…)
db/tests/             tests SQL : sécurité (rôle anon) et simulation de 300 tours
scripts/build.mjs     génère dist/ et config.js ; refuse toute clé secrète
scripts/migrate.sh    applique les migrations une seule fois chacune
scripts/check-secrets.sh   détection de secrets avant fusion
tests/                tests du build et test de l’interface sur une vraie base
.github/workflows/    ci.yml (tests), deploy.yml (Pages), db-migrate.yml (optionnel)
```

## Mise en place (une seule fois)

### 1. Supabase
1. Créez un projet gratuit sur supabase.com.
2. Notez le **Project URL** et la clé **publishable** (ou « anon »), dans *Project Settings > API*.
3. Appliquez les migrations, au choix :
   - **A. À la main** : dans *SQL Editor*, collez puis lancez `db/migrations/001_init.sql`, puis `002_seed_players.sql`.
   - **B. Par workflow** : créez l’environnement `production` (Settings > Environments, avec *Required reviewers*), ajoutez-y le secret `SUPABASE_DB_URL` (chaîne « Session pooler » de Supabase), puis lancez *Actions > DB migrate > Run workflow*.
4. Récupérez les codes personnels : lancez `db/admin/show_codes.sql` **dans le SQL Editor** (jamais en CI) et envoyez à chacun son code en privé.

### 2. GitHub
1. Créez un dépôt **public** (GitHub Pages gratuit) nommé par exemple `amis-invisibles`.
2. *Settings > Secrets and variables > Actions > onglet Variables* : créez `SUPABASE_URL` (Project URL) et `SUPABASE_KEY` (clé publishable). Ce sont des variables et non des secrets : cette clé est publique par conception. Le déploiement est **refusé** si la clé fournie est secrète.
3. *Settings > Pages > Source* : choisissez **GitHub Actions**.
4. Envoyez le code :
   ```bash
   git init -b main
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/<votre-pseudo>/amis-invisibles.git
   git push -u origin main
   ```
5. L’onglet *Actions* montre les tests puis le déploiement. Le lien du site s’affiche dans le job `deploy` et dans *Settings > Pages* (`https://<votre-pseudo>.github.io/amis-invisibles/`).
6. Recommandé : *Settings > Rules > Rulesets* sur `main` : pull request obligatoire, jobs de CI requis, pas de force-push.

## Exploitation

| Besoin | Action |
|---|---|
| Modifier le site | Pull request → CI verte → fusion dans `main` → déploiement automatique |
| Annuler un déploiement | `git revert` du commit sur `main` |
| Nouveau tour | Bouton dans le site (quand tout le monde a tiré) ou `db/admin/reset_round.sql` |
| Ajouter quelqu’un | Nouvelle migration `db/migrations/003_xxx.sql` : l’insertion **et** `update public.game set round = round + 1;` |
| Code perdu ou compromis | `db/admin/rotate_code.sql` dans le SQL Editor, puis envoi du nouveau code en privé |

Exemple de migration pour ajouter un participant :

```sql
insert into public.players (pos, name, code)
values (9, 'Prénom', substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
on conflict (name) do nothing;
update public.game set round = round + 1;
```

## Tests en local

```bash
docker run -d --name ai-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
export PGURL=postgresql://postgres:postgres@localhost:5432/postgres
psql "$PGURL" -c "create role anon nologin" -c "create role authenticated nologin"
DATABASE_URL="$PGURL" bash scripts/migrate.sh
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/tests/security.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/tests/simulation.sql
npm ci && npm test
bash scripts/check-secrets.sh
```

Le test d’interface refuse de tourner contre une base non locale (sauf `ALLOW_REMOTE_DB_TESTS=1`).
Pour voir le site en local : copiez `web/config.example.js` vers `web/config.js`, renseignez vos valeurs, puis `python3 -m http.server -d web`.

## Modèle de sécurité

- **Aucun accès direct aux tables** : RLS activée sans policy et droits retirés au rôle `anon`. Le site ne peut appeler que `get_status`, `draw` et `new_round`.
- **Tirage côté serveur**, sérialisé par un verrou : impossible d’obtenir deux fois le même nom, même avec des clics simultanés. Contraintes SQL en filet de sécurité (`unique (round, receiver)`, `giver <> receiver`).
- **Code personnel** (8 caractères hexadécimaux, 32 bits) vérifié par le serveur, avec une seconde de délai sur chaque échec.
- **Fonctions `security definer`** avec `search_path` fixé, droits d’exécution accordés explicitement.
- **Page** : politique CSP stricte (aucun script en ligne), `referrer` désactivé.
- **Chaîne de livraison** : actions GitHub épinglées par SHA et mises à jour par Dependabot, permissions minimales (`contents: read`), pas de `pull_request_target`, build qui refuse les clés secrètes, détection de secrets.
- **Journaux publics** : aucun script de migration ou de CI n’affiche de code personnel.

Limites assumées : `random()` de PostgreSQL n’est pas un générateur cryptographique (suffisant pour un jeu de cadeaux) ; la personne qui administre Supabase peut lire la table `draws` ; un projet Supabase gratuit peut être mis en pause après une période d’inactivité.
