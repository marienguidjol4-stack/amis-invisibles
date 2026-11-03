#!/usr/bin/env bash
# Échoue si un fichier suivi par git contient un secret probable.
# (Complète, sans la remplacer, la détection de secrets native de GitHub.)
set -uo pipefail
cd "$(dirname "$0")/.."

found=0
check() {
  local label="$1" pattern="$2"
  local hits
  hits=$(git ls-files -z -- . ':!:package-lock.json' ':!:scripts/check-secrets.sh' \
        | xargs -0 grep -InE -- "$pattern" 2>/dev/null \
        | grep -vE 'postgres(ql)?://postgres:postgres@(localhost|127\.0\.0\.1)' || true)
  if [ -n "$hits" ]; then
    echo "Secret probable ($label) :"
    echo "$hits" | cut -c1-120
    found=1
  fi
}

check "clé Supabase secrète"      'sb_secret_[A-Za-z0-9_-]{10,}'
check "JWT (jeton) en clair"      'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
check "URL de base avec mot de passe" 'postgres(ql)?://[^:/[:space:]]+:[^@[:space:]]+@'
check "clé privée"                '-----BEGIN [A-Z ]*PRIVATE KEY-----'

if [ "$found" = 1 ]; then
  echo "Retirez ces valeurs du dépôt (et changez-les : elles sont à considérer comme compromises)."
  exit 1
fi
echo "Aucun secret détecté."
