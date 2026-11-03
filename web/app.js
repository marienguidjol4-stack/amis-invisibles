// Amis invisibles : interface (aucune donnée secrète ici).
(function () {
  "use strict";
  // Configuration injectée au déploiement (voir scripts/build.mjs → config.js)
  const CONFIG = window.APP_CONFIG || {};
  const SUPABASE_URL = CONFIG.supabaseUrl || "";
  const SUPABASE_KEY = CONFIG.supabaseKey || "";

  const REMEMBER_KEY = "amis-invisibles-id";
  const POLL_MS = 5000;

  // ---- appel des fonctions Supabase (RPC), sans bibliothèque ----
  async function rpc(fn, args) {
    const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
    if (SUPABASE_KEY.indexOf("eyJ") === 0) headers.Authorization = "Bearer " + SUPABASE_KEY;
    let res;
    try {
      res = await fetch(SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
        method: "POST", headers: headers, body: JSON.stringify(args || {})
      });
    } catch (e) {
      throw new Error("Connexion impossible. Vérifie ta connexion internet.");
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
    if (!res.ok) throw new Error((data && data.message) || "Erreur du serveur (" + res.status + ").");
    return data;
  }

  // ---- état de l’écran (rien de secret n’est conservé ici) ----
  let status = null;          // { round, players, drawn }
  let screen = "home";        // home | code | reveal
  let current = null;         // nom choisi
  let result = null;          // nom tiré (affiché seulement sur l’écran reveal)
  let flipped = false;
  let busy = false;
  let confirmNew = false;
  let codeDraft = "";         // ce que la personne est en train de taper (survit aux réaffichages)
  let rememberDraft = null;
  let errorMsg = "";
  let pollTimer = null;

  const app = document.getElementById("app");

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v === null || v === false) return;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    });
    (children || []).forEach(c => { if (c) node.appendChild(c); });
    return node;
  }

  function loadRemembered() {
    try { return JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null"); } catch (e) { return null; }
  }
  function saveRemembered(name, code, on) {
    try {
      if (on) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: name, code: code }));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (e) { /* stockage indisponible */ }
  }

  const allDrawn = () => status && status.players.length > 0 && status.drawn.length >= status.players.length;

  async function refresh(silent) {
    try {
      status = await rpc("get_status");
      if (!silent) errorMsg = "";
    } catch (e) {
      if (!silent) errorMsg = e.message;
      else if (!status) errorMsg = e.message;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(async () => {
      if (screen === "reveal" || busy || document.hidden) return;
      const before = status ? JSON.stringify(status) : "";
      await refresh(true);
      if (status && JSON.stringify(status) !== before && screen === "home") render(false);
    }, POLL_MS);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

  function progressNode() {
    const total = status.players.length, n = status.drawn.length;
    const dots = h("div", { class: "dots", "aria-hidden": "true" },
      status.players.map((_, i) => h("span", { class: "dot" + (i < n ? " on" : "") })));
    return h("div", { class: "progress" }, [dots, h("span", { text: n + " sur " + total + " ont tiré" })]);
  }

  function brand() { return h("p", { class: "brand", text: "Amis invisibles" }); }

  // ---- écran d’accueil ----
  function renderHome() {
    app.appendChild(brand());
    if (!status) {
      app.appendChild(h("h2", { text: "Connexion…" }));
      if (errorMsg) {
        app.appendChild(h("p", { class: "error", role: "alert", text: errorMsg }));
        app.appendChild(h("div", { class: "actions" }, [
          h("button", { class: "btn btn-quiet", type: "button", text: "Réessayer", onclick: start })
        ]));
      }
      return;
    }
    app.appendChild(h("h2", { text: allDrawn() ? "Tout le monde a tiré" : "Qui es-tu ?" }));
    app.appendChild(h("p", {
      class: "lead",
      text: allDrawn()
        ? "Touche ton nom et entre ton code pour revoir ton tirage, ou lancer un nouveau tour."
        : "Touche ton nom, entre ton code personnel, puis tire au sort la personne à qui tu offres un cadeau."
    }));
    app.appendChild(progressNode());
    app.appendChild(h("ul", { class: "names" }, status.players.map(name => {
      const done = status.drawn.indexOf(name) !== -1;
      return h("li", {}, [h("button", {
        class: "name-btn" + (done ? " is-done" : ""), type: "button",
        onclick: () => { current = name; screen = "code"; errorMsg = ""; confirmNew = false; codeDraft = ""; rememberDraft = null; render(true); }
      }, [h("span", { text: name }), done ? h("span", { class: "status", text: "a tiré" }) : null])]);
    })));
    if (errorMsg) app.appendChild(h("p", { class: "error", role: "alert", text: errorMsg }));
  }

  // ---- écran du code personnel ----
  function renderCode() {
    const done = status.drawn.indexOf(current) !== -1;
    const remembered = loadRemembered();
    const input = h("input", {
      id: "code", type: "password", autocomplete: "off", autocapitalize: "none", autocorrect: "off",
      spellcheck: "false", maxlength: "32", "aria-describedby": "code-help"
    });
    const isMine = !!(remembered && remembered.name === current);
    input.value = codeDraft || (isMine ? remembered.code : "");
    input.addEventListener("input", () => { codeDraft = input.value; });
    const remember = h("input", { id: "remember", type: "checkbox", checked: rememberDraft === null ? isMine : rememberDraft });
    remember.addEventListener("change", () => { rememberDraft = remember.checked; });
    const submitBtn = h("button", {
      class: "btn btn-primary", type: "button", disabled: busy,
      text: busy ? "Un instant…" : (done ? "Revoir mon tirage" : "Tirer au sort"),
      onclick: () => submitCode(input.value.trim(), remember.checked)
    });
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submitBtn.click(); } });

    app.appendChild(brand());
    app.appendChild(h("h2", { text: "Salut " + current }));
    app.appendChild(h("p", { id: "code-help", class: "lead", text: "Entre le code personnel que tu as reçu en privé. Il protège ton tirage." }));
    app.appendChild(h("div", { class: "field" }, [h("label", { for: "code", text: "Ton code" }), input]));
    app.appendChild(h("label", { class: "check", for: "remember" }, [remember, h("span", { text: "Retenir mon code sur cet appareil" })]));

    const actions = [submitBtn];
    if (allDrawn()) {
      if (!confirmNew) {
        actions.push(h("button", {
          class: "btn btn-quiet", type: "button", text: "Lancer un nouveau tirage",
          onclick: () => { confirmNew = true; render(false); }
        }));
      } else {
        actions.push(h("p", { class: "confirm-text", text: "Les tirages de ce tour seront perdus et les " + status.players.length + " noms seront de nouveau disponibles." }));
        actions.push(h("button", {
          class: "btn btn-danger", type: "button", disabled: busy, text: "Effacer et recommencer",
          onclick: () => startNewRound(input.value.trim(), remember.checked)
        }));
        actions.push(h("button", { class: "btn btn-quiet", type: "button", text: "Annuler", onclick: () => { confirmNew = false; render(false); } }));
      }
    }
    actions.push(h("button", { class: "link-btn", type: "button", text: "Ce n’est pas moi", onclick: () => { screen = "home"; errorMsg = ""; confirmNew = false; render(true); } }));
    app.appendChild(h("div", { class: "actions" }, actions));
    if (errorMsg) app.appendChild(h("p", { class: "error", role: "alert", text: errorMsg }));
  }

  async function submitCode(code, remember) {
    if (!code) { errorMsg = "Entre ton code personnel."; render(false); return; }
    busy = true; errorMsg = ""; render(false);
    try {
      result = await rpc("draw", { p_name: current, p_code: code });
      saveRemembered(current, code, remember);
      codeDraft = ""; rememberDraft = null;
      flipped = false; screen = "reveal";
      busy = false;
      refresh(true);
      render(true);
    } catch (e) {
      busy = false; errorMsg = e.message; render(false);
    }
  }

  async function startNewRound(code, remember) {
    if (!code) { errorMsg = "Entre ton code personnel."; render(false); return; }
    busy = true; errorMsg = ""; render(false);
    try {
      await rpc("new_round", { p_name: current, p_code: code });
      saveRemembered(current, code, remember);
      codeDraft = ""; rememberDraft = null;
      confirmNew = false; busy = false;
      await refresh(false);
      screen = "home"; render(true);
    } catch (e) {
      busy = false; errorMsg = e.message; render(false);
    }
  }

  // ---- écran de révélation ----
  function renderReveal(animate) {
    const kids = flipped ? [
      h("p", { class: "who-line", text: current + ", tu offres un cadeau à" }),
      h("p", { class: "target", text: result })
    ] : [];
    const tag = h("div", { class: "tag" }, [
      h("div", { class: "face back", "aria-hidden": "true" }),
      h("div", { class: "face front" }, kids)
    ]);
    if (flipped) {
      if (animate) requestAnimationFrame(() => requestAnimationFrame(() => tag.classList.add("flipped")));
      else tag.classList.add("flipped");
    }
    app.appendChild(brand());
    app.appendChild(h("h2", { text: flipped ? "Voici ton tirage" : "C’est prêt, " + current }));
    app.appendChild(h("p", {
      class: "lead",
      text: flipped ? "Retiens bien ce nom. Tu pourras le revoir avec ton code." : "Vérifie que personne d’autre ne regarde l’écran, puis dévoile ton tirage."
    }));
    app.appendChild(h("div", { class: "scene" }, [tag]));
    app.appendChild(h("div", { class: "actions" }, [
      flipped
        ? h("button", { class: "btn btn-primary", type: "button", text: "J’ai noté, masquer", onclick: hideResult })
        : h("button", { class: "btn btn-primary", type: "button", text: "Dévoiler mon tirage", onclick: () => { flipped = true; render(true); } })
    ]));
  }

  function hideResult() {
    result = null; flipped = false; current = null; screen = "home";
    render(true);
  }

  function render(focus) {
    app.replaceChildren();
    if (screen === "reveal") renderReveal(!!focus);
    else if (screen === "code" && status) renderCode();
    else renderHome();
    if (focus) {
      const title = app.querySelector("h2");
      if (title) { title.setAttribute("tabindex", "-1"); title.focus({ preventScroll: true }); }
    }
  }

  async function start() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      app.replaceChildren(brand(), h("h2", { text: "Page non configurée" }),
        h("p", { class: "lead", text: "Cette page n’a pas reçu sa configuration. Préviens la personne qui organise le tirage." }));
      return;
    }
    errorMsg = ""; render(false);
    await refresh(false);
    render(false);
    startPolling();
  }

  start();
})();
