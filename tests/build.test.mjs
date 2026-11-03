import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, validateConfig } from "../scripts/build.mjs";

const URL_OK = "https://abcdefghij.supabase.co";
const PUB = "sb_publishable_abcdefghijklmnopqrstuvwxyz";
const jwt = role =>
  ["e30", Buffer.from(JSON.stringify({ role })).toString("base64url"), "signature"].join(".");
// Faux secret construit dynamiquement : le dépôt ne contient jamais de littéral « sb_secret_… ».
const FAKE_SECRET = ["sb", "secret", "abcdefghijklmnop"].join("_");
const tmp = () => mkdtempSync(join(tmpdir(), "ai-build-"));

test("accepte une clé publishable et génère config.js", () => {
  const out = build({ url: URL_OK + "/", key: PUB, out: tmp() });
  const cfg = readFileSync(join(out, "config.js"), "utf8");
  assert.match(cfg, /window\.APP_CONFIG/);
  assert.ok(cfg.includes(URL_OK) && !cfg.includes(URL_OK + "/\""), "slash final retiré");
  assert.ok(existsSync(join(out, "index.html")) && existsSync(join(out, "app.js")));
  assert.ok(!existsSync(join(out, "config.example.js")), "l’exemple n’est pas publié");
});

test("accepte un JWT de rôle anon", () => {
  assert.deepEqual(validateConfig(URL_OK, jwt("anon")), []);
});

test("refuse une clé secrète sb_secret_", () => {
  const e = validateConfig(URL_OK, FAKE_SECRET);
  assert.ok(e.some(m => /SECRÈTE/.test(m)));
  assert.throws(() => build({ url: URL_OK, key: FAKE_SECRET, out: tmp() }));
});

test("refuse un JWT service_role", () => {
  const e = validateConfig(URL_OK, jwt("service_role"));
  assert.ok(e.some(m => /service_role/.test(m)));
});

test("refuse les valeurs vides ou de format inconnu", () => {
  assert.ok(validateConfig("", "").length >= 2);
  assert.ok(validateConfig(URL_OK, "n-importe-quoi").length === 1);
});

test("refuse http:// et les hôtes hors supabase.co (sauf option explicite)", () => {
  assert.ok(validateConfig("http://abc.supabase.co", PUB).length > 0);
  assert.ok(validateConfig("https://exemple.com", PUB).length > 0);
  assert.deepEqual(validateConfig("https://exemple.com", PUB, { ALLOW_CUSTOM_HOST: "1" }), []);
});
