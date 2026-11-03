#!/usr/bin/env bash
# Applique db/migrations/*.sql dans l’ordre, une seule fois chacune.
# Usage : DATABASE_URL=postgresql://... bash scripts/migrate.sh
# Ce script n’affiche que des noms de fichiers : les journaux de CI peuvent être publics.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL est requis}"
cd "$(dirname "$0")/.."

psql_() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -At "$@"; }

psql_ <<'SQL'
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
SQL

applied=0
for f in db/migrations/*.sql; do
  v="$(basename "$f")"
  if [ "$(psql_ -c "select 1 from public.schema_migrations where version = '$v'")" = "1" ]; then
    echo "déjà appliquée : $v"
    continue
  fi
  echo "application de  : $v"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" >/dev/null
  psql_ -c "insert into public.schema_migrations (version) values ('$v')" >/dev/null
  applied=$((applied + 1))
done
echo "terminé : $applied migration(s) appliquée(s)"
