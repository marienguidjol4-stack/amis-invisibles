// Test de bout en bout : la vraie page (dist/) dans jsdom, branchée sur une vraie
// base PostgreSQL (migrations appliquées) à la place de Supabase.
// Lancer avec : PGURL=postgresql://postgres:postgres@localhost:5432/postgres npm run test:ui
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { build } from "../scripts/build.mjs";

const PGURL = process.env.PGURL;
const local = PGURL && /@(localhost|127\.0\.0\.1)(:|\/)/.test(PGURL);
const skip = !PGURL ? "PGURL non défini" : !local && process.env.ALLOW_REMOTE_DB_TESTS !== "1"
  ? "PGURL n’est pas une base locale (ALLOW_REMOTE_DB_TESTS=1 pour forcer)" : false;

const psql = sql => execFileSync("psql", [PGURL, "-At", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

// Remplace l’appel réseau vers Supabase par un appel direct à la base, avec le rôle « anon ».
function fakeFetch(url, opts) {
  const fn = url.split("/rpc/")[1];
  const a = JSON.parse(opts.body || "{}");
  const sql = {
    get_status: "set role anon; select public.get_status()",
    draw: `set role anon; select to_json(public.draw(${q(a.p_name)}, ${q(a.p_code)}))`,
    new_round: `set role anon; select public.new_round(${q(a.p_name)}, ${q(a.p_code)})`
  }[fn];
  try {
    const body = psql(sql).trim();
    return Promise.resolve({ ok: true, status: 200, text: async () => body });
  } catch (e) {
    const m = /ERROR:\s+(.*)/.exec(String(e.stderr));
    return Promise.resolve({ ok: false, status: 400, text: async () => JSON.stringify({ message: m ? m[1] : "erreur" }) });
  }
}

test("parcours complet : tirages, revoir, nouveau tour", { skip, timeout: 180000 }, async () => {
  const dist = build({ url: "https://ci-placeholder.supabase.co", key: "sb_publishable_ci_placeholder",
                       out: mkdtempSync(join(tmpdir(), "ai-ui-")) });
  psql("update public.game set round = round + 1");               // tour neuf
  const rows = psql("select name || ':' || code from public.players order by pos").trim().split("\n");
  const names = rows.map(r => r.split(":")[0]);
  const codes = Object.fromEntries(rows.map(r => r.split(":")));

  // On exécute config.js puis app.js « à la main » dans la fenêtre jsdom : cela ne dépend
  // d'aucune API de chargement de ressources, qui a changé entre les versions de jsdom.
  const html = readFileSync(join(dist, "index.html"), "utf8").replace(/<script src="[^"]+"><\/script>/g, "");
  const dom = new JSDOM(html, {
    url: "https://amis.test/", runScripts: "outside-only", pretendToBeVisual: true,
    beforeParse(w) { w.fetch = fakeFetch; }
  });
  dom.window.eval(readFileSync(join(dist, "config.js"), "utf8"));
  dom.window.eval(readFileSync(join(dist, "app.js"), "utf8"));
  const w = dom.window, d = w.document;
  const text = () => d.getElementById("app").textContent;
  const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const btn = label => [...d.querySelectorAll("button")].find(b => b.textContent.includes(label));
  const nameBtn = n => [...d.querySelectorAll(".name-btn")].find(b => b.textContent.startsWith(n));
  const waitFor = async (fn, what, ms = 15000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn(); if (v) return v;
      if (Date.now() - t0 > ms) assert.fail(`délai dépassé : ${what}\nÉcran : ${text()}`);
      await new Promise(r => setTimeout(r, 40));
    }
  };
  const setCode = v => { const i = d.getElementById("code"); i.value = v; i.dispatchEvent(new w.Event("input")); };

  await waitFor(() => d.querySelector(".name-btn"), "liste des noms");
  assert.deepEqual([...d.querySelectorAll(".name-btn span:first-child")].map(e => e.textContent), names);

  // Mauvais code : refusé, la saisie n’est pas perdue.
  click(nameBtn(names[0])); await waitFor(() => d.getElementById("code"), "écran du code");
  setCode("pasbon"); click(btn("Tirer au sort"));
  await waitFor(() => /incorrect/.test(text()), "refus du mauvais code");
  assert.equal(d.getElementById("code").value, "pasbon");

  // Tout le monde tire, dans un ordre aléatoire.
  const order = [...names].sort(() => Math.random() - 0.5);
  const got = {};
  for (const n of order) {
    if (!d.querySelector(".name-btn")) { click(btn("Ce n’est pas moi")); await waitFor(() => d.querySelector(".name-btn"), "accueil"); }
    click(nameBtn(n)); await waitFor(() => d.getElementById("code"), "écran du code");
    setCode(codes[n]); click(btn("Tirer au sort"));
    await waitFor(() => btn("Dévoiler mon tirage"), `révélation de ${n}`);
    assert.ok(!d.querySelector(".target"), "le nom ne doit pas être visible avant le dévoilement");
    click(btn("Dévoiler mon tirage"));
    got[n] = (await waitFor(() => d.querySelector(".target"), `résultat de ${n}`)).textContent;
    click(btn("J’ai noté")); await waitFor(() => d.querySelector(".name-btn"), "retour à l’accueil");
  }
  assert.equal(new Set(Object.values(got)).size, names.length, "aucun nom tiré deux fois");
  assert.ok(Object.entries(got).every(([g, r]) => g !== r), "personne ne se tire lui-même");
  await waitFor(() => /Tout le monde a tiré/.test(text()), "écran de fin");

  // Revoir son tirage avec son code : même résultat.
  const first = names[0];
  click(nameBtn(first)); await waitFor(() => d.getElementById("code"), "écran du code");
  setCode(codes[first]); click(btn("Revoir mon tirage"));
  await waitFor(() => btn("Dévoiler mon tirage"), "révélation (revoir)");
  click(btn("Dévoiler mon tirage"));
  assert.equal((await waitFor(() => d.querySelector(".target"), "résultat (revoir)")).textContent, got[first]);
  click(btn("J’ai noté")); await waitFor(() => d.querySelector(".name-btn"), "accueil");

  // Nouveau tour.
  click(nameBtn(first)); await waitFor(() => d.getElementById("code"), "écran du code");
  setCode(codes[first]); click(btn("Lancer un nouveau tirage"));
  click(await waitFor(() => btn("Effacer et recommencer"), "confirmation"));
  await waitFor(() => /Qui es-tu/.test(text()) && text().includes(`0 sur ${names.length}`), "nouveau tour");

  w.close();
});
