#!/usr/bin/env node
// Construit le site statique dans dist/ (ou --out <dossier>) :
//  - copie web/* (sauf config.example.js) ;
//  - génère config.js à partir des variables SUPABASE_URL et SUPABASE_KEY ;
//  - REFUSE de construire si la clé est une clé secrète (service_role, sb_secret_…).
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function validateConfig(url, key, env = {}) {
  const errors = [];

  // --- URL du projet ---
  let parsed = null;
  try { parsed = new URL(url || ""); } catch { /* invalide */ }
  if (!parsed) errors.push("SUPABASE_URL est vide ou invalide.");
  else {
    if (parsed.protocol !== "https:") errors.push("SUPABASE_URL doit commencer par https://.");
    if (!parsed.hostname.endsWith(".supabase.co") && env.ALLOW_CUSTOM_HOST !== "1") {
      errors.push("SUPABASE_URL doit se terminer par .supabase.co (ALLOW_CUSTOM_HOST=1 pour un domaine personnalisé).");
    }
  }

  // --- Clé : uniquement une clé publique ---
  const k = (key || "").trim();
  if (!k) errors.push("SUPABASE_KEY est vide.");
  else if (k.startsWith("sb_secret_")) errors.push("SUPABASE_KEY est une clé SECRÈTE (sb_secret_…) : refusé. Utilisez la clé publishable/anon.");
  else if (k.startsWith("sb_publishable_")) { /* ok */ }
  else if (k.split(".").length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8"));
      if (payload.role !== "anon") errors.push(`SUPABASE_KEY est un JWT de rôle « ${payload.role} » : seul le rôle « anon » est accepté.`);
    } catch { errors.push("SUPABASE_KEY ressemble à un JWT illisible."); }
  } else errors.push("SUPABASE_KEY a un format inconnu (attendu : sb_publishable_… ou JWT « anon »).");

  return errors;
}

export function build({ url, key, out, env = {} }) {
  const errors = validateConfig(url, key, env);
  if (errors.length) { const e = new Error(errors.join("\n")); e.errors = errors; throw e; }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(join(root, "web"))) {
    if (f === "config.example.js" || f === "config.js") continue;
    cpSync(join(root, "web", f), join(out, f), { recursive: true });
  }
  const config = { supabaseUrl: url.trim().replace(/\/+$/, ""), supabaseKey: key.trim() };
  writeFileSync(join(out, "config.js"), `window.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
  return out;
}

// Exécution en ligne de commande
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  const out = resolve(i > -1 ? process.argv[i + 1] : join(root, "dist"));
  try {
    build({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_KEY, out, env: process.env });
    console.log(`Site construit dans ${out}`);
  } catch (e) {
    console.error("Build refusé :\n" + e.message);
    process.exit(1);
  }
}
