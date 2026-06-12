/* ROCKFALL net.js — optional online layer (SpacetimeDB + SpacetimeAuth).
   Loaded after net-config.js. If window.__NET__ is missing or incomplete,
   everything below stays dormant and the game remains fully offline. */
"use strict";
(function () {
  const NET = window.__NET__;
  if (!NET || !NET.host || !NET.db || !NET.authUrl || !NET.clientId) return;

  const AUTH_KEY = "rf_net_auth";
  const PKCE_KEY = "rf_net_pkce";
  const $ = (id) => document.getElementById(id);

  /* ------------------------- auth state ------------------------- */
  let auth = null; // { token, exp, name }
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const a = JSON.parse(raw);
      if (a && a.exp * 1000 > Date.now() + 60_000) auth = a;
    }
  } catch (e) {}

  const b64url = (buf) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  function parseJwt(tok) {
    try {
      const p = tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return {}; }
  }

  async function discovery() {
    const r = await fetch(NET.authUrl.replace(/\/$/, "") + "/.well-known/openid-configuration");
    if (!r.ok) throw new Error("OIDC discovery failed");
    return r.json();
  }

  async function startLogin() {
    const cfg = await discovery();
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, token_endpoint: cfg.token_endpoint }));
    const redirect = location.origin + location.pathname;
    const u = new URL(cfg.authorization_endpoint);
    u.searchParams.set("client_id", NET.clientId);
    u.searchParams.set("redirect_uri", redirect);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", "openid profile email");
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    location.assign(u.toString());
  }

  async function finishLogin() {
    const qs = new URLSearchParams(location.search);
    const code = qs.get("code");
    if (!code) return false;
    let pk = null;
    try { pk = JSON.parse(sessionStorage.getItem(PKCE_KEY) || "null"); } catch (e) {}
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, "", location.origin + location.pathname); // clean ?code= from URL
    if (!pk || qs.get("state") !== pk.state) return false;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: location.origin + location.pathname,
      client_id: NET.clientId,
      code_verifier: pk.verifier,
    });
    const r = await fetch(pk.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!r.ok) { console.warn("[net] token exchange failed", await r.text()); return false; }
    const tok = await r.json();
    const idt = tok.id_token;
    if (!idt) return false;
    const claims = parseJwt(idt);
    auth = {
      token: idt,
      exp: claims.exp || Math.floor(Date.now() / 1000) + 3000,
      name: claims.preferred_username || claims.name || (claims.email || "Boulder").split("@")[0],
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    await call("register_player", [auth.name]).catch((e) => console.warn("[net] register", e));
    return true;
  }

  function logout() {
    auth = null;
    localStorage.removeItem(AUTH_KEY);
    renderMenu();
  }

  /* --------------------- SpacetimeDB HTTP API --------------------- */
  const base = NET.host.replace(/\/$/, "") + "/v1/database/" + encodeURIComponent(NET.db);

  async function call(reducer, args) {
    const r = await fetch(base + "/call/" + encodeURIComponent(reducer), {
      method: "POST",
      headers: Object.assign(
        { "Content-Type": "application/json" },
        auth ? { Authorization: "Bearer " + auth.token } : {}
      ),
      body: JSON.stringify(args || []),
    });
    if (!r.ok) throw new Error(reducer + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  }

  async function sql(query) {
    const r = await fetch(base + "/sql", {
      method: "POST",
      headers: auth ? { Authorization: "Bearer " + auth.token } : {},
      body: query,
    });
    if (!r.ok) throw new Error("sql -> " + r.status);
    const out = await r.json();
    // Tolerant parser: result is an array of statement results with schema + rows.
    const st = Array.isArray(out) ? out[0] : out;
    if (!st) return [];
    const rows = st.rows || st.Rows || [];
    const schema = st.schema || st.Schema || {};
    const els = schema.elements || schema.Elements || [];
    const cols = els.map((e, i) => {
      const n = e.name;
      return (n && (n.some || n.Some)) || (typeof n === "string" ? n : "c" + i);
    });
    return rows.map((row) => {
      if (Array.isArray(row)) {
        const o = {};
        row.forEach((v, i) => { o[cols[i] || "c" + i] = v; });
        return o;
      }
      return row;
    });
  }

  const num = (v) => (typeof v === "string" ? parseFloat(v) : typeof v === "bigint" ? Number(v) : Number(v) || 0);
  const sqlStr = (x) => "'" + String(x).replace(/'/g, "''") + "'";

  async function leaderboards() {
    const rows = await sql("SELECT name, score, dist_m, duration_s FROM score_entry");
    const norm = rows.map((r) => ({
      name: String(r.name ?? "?"),
      score: num(r.score), dist: num(r.dist_m), dur: num(r.duration_s),
    }));
    const by = (k) => [...norm].sort((a, b) => b[k] - a[k]);
    return { score: by("score"), dist: by("dist"), dur: by("dur"), all: norm };
  }

  /* ----------------------- grants delivery ----------------------- */
  async function pullGrants() {
    if (!auth || !window.RFGame || !window.RFGame.applyGrants) return;
    try {
      const rows = await sql("SELECT id, kind, value FROM grant WHERE target_name = " + sqlStr(auth.name));
      const list = rows.map((r) => ({ id: num(r.id), kind: String(r.kind), value: String(r.value) }))
        .sort((a, b) => a.id - b.id);
      if (list.length) window.RFGame.applyGrants(list);
    } catch (e) { console.warn("[net] grants", e); }
  }

  /* ----------------------- presence (multiplayer) ----------------------- */
  let lastSend = 0, lastPoll = 0, remotes = [];
  async function presence(p) {
    if (!auth) return;
    const now = Date.now();
    if (now - lastSend > 1200) {
      lastSend = now;
      call("update_pos", [p.x, p.y, p.z, Math.max(0, Math.floor(p.dist)), now]).catch(() => {});
    }
    if (now - lastPoll > 2500) {
      lastPoll = now;
      try {
        const rows = await sql("SELECT name, x, y, z, dist_m, at_ms FROM live_pos");
        const cut = now - 12_000;
        remotes = rows
          .map((r) => ({ name: String(r.name), x: num(r.x), y: num(r.y), z: num(r.z), dist: num(r.dist_m), at: num(r.at_ms) }))
          .filter((r) => r.name !== auth.name && r.at > cut);
      } catch (e) {}
    }
  }

  /* ------------------------- game hooks ------------------------- */
  window.RFNet = {
    loggedIn: () => !!auth,
    presence,
    getRemotes: () => remotes,
    leaveLive() { if (auth) call("leave_live", []).catch(() => {}); },

    async listGhosts() {
      const rows = await sql("SELECT name, score, dist_m FROM ghost");
      return rows.map((r) => ({ name: String(r.name), score: num(r.score), dist: num(r.dist_m) }))
        .sort((a, b) => b.score - a.score);
    },
    async fetchGhost(name) {
      const rows = await sql("SELECT data FROM ghost WHERE name = " + sqlStr(name));
      if (!rows.length) return null;
      try { return JSON.parse(atob(String(rows[0].data))); } catch (e) { return null; }
    },

    renderMenu() {
      const row = $("netRow"); if (!row) return;
      row.classList.remove("hidden");
      $("btnLogin").classList.toggle("hidden", !!auth);
      $("btnLogout").classList.toggle("hidden", !auth);
      $("netUser").textContent = auth ? "⛰ " + auth.name : "";
      pullGrants();
    },

    async onRunEnd(p) {
      if (!auth) return;
      try {
        await call("submit_run", [Math.max(0, Math.floor(p.score)), Math.max(0, Math.floor(p.dist)), Math.max(0, Math.floor(p.duration))]);
        if (p.ghost && p.ghost.length > 10) {
          const data = btoa(JSON.stringify(p.ghost));
          if (data.length < 240_000)
            call("save_ghost", [data, Math.floor(p.score), Math.floor(p.dist)]).catch(() => {});
        }
        const lb = await leaderboards();
        // overall = sum of category ranks (lower is better)
        const firsts = [];
        if (lb.score[0] && p.score >= lb.score[0].score && lb.score[0].name === auth.name) firsts.push("WORLD HIGH SCORE");
        if (lb.dist[0] && p.dist >= lb.dist[0].dist && lb.dist[0].name === auth.name) firsts.push("WORLD LONGEST RUN");
        if (lb.dur[0] && p.duration >= lb.dur[0].dur && lb.dur[0].name === auth.name) firsts.push("WORLD LONGEST SURVIVAL");
        {
          const rk = (arr, k, v) => 1 + arr.filter((r) => r[k] > v).length;
          const overall = rk(lb.score, "score", p.score) + rk(lb.dist, "dist", p.dist) + rk(lb.dur, "dur", p.duration);
          let best = Infinity;
          const byName = {};
          for (const r of lb.all) {
            const o = rk(lb.score, "score", r.score) + rk(lb.dist, "dist", r.dist) + rk(lb.dur, "dur", r.dur);
            if (!(r.name in byName) || o < byName[r.name]) byName[r.name] = o;
          }
          for (const n in byName) if (byName[n] < best) best = byName[n];
          if (overall <= best) firsts.push("OVERALL #1");
        }
        if (firsts.length) {
          const eb = $("endBest");
          if (eb) { eb.classList.remove("hidden"); eb.textContent = "🌍 " + firsts.join(" · ") + " — #1!"; }
          if (window.__fanfare) window.__fanfare();
        }
      } catch (e) { console.warn("[net] submit", e); }
    },

    async fillGlobalRecords(container, summary) {
      try {
        const lb = await leaderboards();
        if (!lb.all.length) return;
        const rank = (arr, key, val) => 1 + arr.filter((r) => r[key] > val).length;
        const div = document.createElement("div");
        div.className = "hs-table";
        const top = (arr, key, unit) => arr.slice(0, 5)
          .map((r, i) => (i + 1) + ". <b>" + r.name + "</b> · " + Math.floor(r[key]).toLocaleString("en-US") + unit).join("<br>");
        div.innerHTML =
          "<b>🌍 Global — this run placed</b><br>" +
          "#" + rank(lb.score, "score", summary.score) + " by score · " +
          "#" + rank(lb.dist, "dist", summary.dist) + " by distance · " +
          "#" + rank(lb.dur, "dur", summary.duration) + " by survival<br><br>" +
          "<b>Top scores</b><br>" + top(lb.score, "score", "") + "<br><br>" +
          "<b>Top distance</b><br>" + top(lb.dist, "dist", " m") + "<br><br>" +
          "<b>Overall</b><br>rank sum " + (rank(lb.score, "score", summary.score) + rank(lb.dist, "dist", summary.dist) + rank(lb.dur, "dur", summary.duration)) + " across score + distance + survival (lower = better)";
        container.appendChild(div);
      } catch (e) { console.warn("[net] leaderboard", e); }
    },
  };

  /* ------------------------- boot ------------------------- */
  function bindUI() {
    const bl = $("btnLogin"), bo = $("btnLogout");
    if (bl) bl.addEventListener("click", () => startLogin().catch((e) => alert("Sign-in failed: " + e.message)));
    if (bo) bo.addEventListener("click", logout);
    window.RFNet.renderMenu();
  }
  finishLogin().catch((e) => console.warn("[net] login finish", e)).finally(() => {
    if (auth && auth.exp * 1000 < Date.now()) logout();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUI);
    else bindUI();
  });
})();
