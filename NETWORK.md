# ROCKFALL — Online features plan (SpacetimeDB)

This document answers the setup questions and defines everything that must be prepared
before the online layer (accounts, leaderboards, ghosts, admin, multiplayer) can be wired in.
The game itself stays a static GitHub Pages site; SpacetimeDB hosts all server logic.

> Status: **first integration shipped.** What exists now:
> - `spacetime-module/` — TypeScript server module (player / score_entry / ghost / grant,
>   first-user-becomes-admin, server-side run validation, per-player score pruning)
> - `net.js` — OIDC PKCE login via SpacetimeAuth, run submission, global leaderboards in the
>   end-screen Records tab, world-#1 fanfare, last-run ghost upload
> - `admin.html` — players list, recent runs, grant/admin/wipe actions
> - `pages.yml` — generates `net-config.js` from repo *variables* and publishes the module
>   using the `SPACETIME_PUBLISH_TOKEN` secret
>
> Everything degrades gracefully: without `net-config.js` the game is fully offline.
> **First live run will need debugging together** — the module API and CLI flags were written
> against the 2.0 docs but could not be executed from this environment. Send me the first
> errors from the Actions log and the browser DevConsole.
>
> Next iterations: ghost playback with timeline + speed control, grant delivery to clients,
> live multiplayer boulders (WebSocket subscriptions).

## 1. What you need to set up in SpacetimeDB

You already have a database (its **name** and **identity/id**). Additionally:

1. **A server module** — SpacetimeDB logic is written as a module (Rust or C#) that you
   `spacetime publish` to your database. The tables we'll need:
   - `player` (identity PK, display_name, is_admin, created_at, google_sub)
   - `score_entry` (player, score, distance_m, duration_s, achieved_at) — leaderboards are
     just ranked queries over this
   - `ghost` (player, run_id, created_at, compressed_frames BLOB) — one stored ghost per
     player + "last run" slot
   - `grant` (admin actions: skin grants, goal confirmations, bans)
   Reducers (server functions): `register_player`, `submit_run(score, dist, duration, ghost?)`,
   `save_ghost`, `admin_grant_skin`, `admin_confirm_goal`, `admin_set_role`.
   **Important:** the server must validate submissions (sanity caps on score/distance vs
   duration), because the client can never be trusted — our save-file signing helps locally
   but means nothing for a public leaderboard.

2. **spacetime-auth (OIDC): yes, enable it.** That's exactly the right mechanism for
   "Sign in with Google":
   - In Google Cloud Console (your org account): create an **OAuth 2.0 Client ID**
     (type: Web application). Authorized origins: `https://<you>.github.io`;
     redirect URI: the one spacetime-auth gives you for your auth instance.
     This yields a **Google client ID + client secret**.
   - In spacetime-auth: register Google as an OIDC provider using that client ID/secret.
     spacetime-auth then issues identities your module sees as the caller identity.
   - **First-user-becomes-admin:** implemented in the module's `register_player` reducer —
     if `player` table is empty, set `is_admin = true` for the caller. No console setup needed.

3. **What goes into GitHub repo (Settings → Secrets and variables → Actions):**

   | Name | Type | Used for |
   |---|---|---|
   | `SPACETIME_DB_NAME` | variable | database name (public, baked into the client at build) |
   | `SPACETIME_HOST` | variable | e.g. `https://maincloud.spacetimedb.com` (public) |
   | `SPACETIME_AUTH_URL` | variable | your spacetime-auth instance URL (public) |
   | `GOOGLE_OAUTH_CLIENT_ID` | variable | public by nature (it's sent to the browser) |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | **secret** | used ONLY by spacetime-auth config / publish pipeline — never shipped to the client |
   | `SPACETIME_PUBLISH_TOKEN` | **secret** | CI token so the workflow can `spacetime publish` the module on push |

   Rule of thumb: anything the browser needs is a *variable* (it's public anyway);
   anything that grants control (client secret, publish token) is a *secret* and is only
   consumed inside GitHub Actions. The Pages build step injects variables into a generated
   `net-config.js`.

4. **Client side (planned `net.js` layer):** SpacetimeDB TypeScript SDK via CDN, feature-flagged —
   if `net-config.js` is absent the game silently stays offline (everything keeps working as now).
   Login button on the main menu → spacetime-auth OIDC popup → identity token cached.

## 2. Feature mapping once the backend exists

- **Leaderboards** (High Score / Longest Run / Longest Survival / Overall): ranked reads of
  `score_entry`; the end-screen **Records tab** already shows local placement and will swap
  to global placement + your rank per category.
- **Fanfare on #1:** the submit reducer returns previous bests; if you took a top spot the
  client triggers the existing `fanfare()` (confetti + jingle) with a "WORLD #1" banner.
- **Ghosts:** the client already has everything needed to record one (position + time per
  ~50 ms, delta-compressed ≈ a few KB/min). `save_ghost` stores it; playback renders a
  translucent second boulder with a timeline scrubber + speed control.
- **Admin panel:** separate `admin.html` page (same repo) — table of players, buttons that
  call `admin_*` reducers; server checks `is_admin`.
- **Multiplayer (live boulders):** SpacetimeDB row subscriptions on a `live_position` table,
  each client upserting ~10×/s; others render as ghost boulders. Same netcode as ghosts.

## 3. What I need from you to do the integration

1. Database name + host region (you have these).
2. spacetime-auth instance URL after you enable it.
3. Google OAuth client ID (the secret stays in GH secrets — I never need to see it).
4. Confirm module language preference (Rust or C#) — I'll generate the module source,
   the CI publish step in `pages.yml`, and the client `net.js`.
