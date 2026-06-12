/**
 * ROCKFALL — SpacetimeDB server module (TypeScript, SpacetimeDB 2.0)
 *
 * Tables:
 *   player      — one row per authenticated identity; first ever player becomes admin
 *   score_entry — submitted runs (leaderboards are reads over this)
 *   ghost       — one stored ghost per player (last/best run replay data)
 *   grant       — audit log of admin actions (skin grants, goal confirms, ...)
 *
 * Publish:  spacetime publish --project-path spacetime-module <DB_NAME>
 */
import { schema, table, t } from 'spacetimedb/server';

/* ============================== tables ============================== */

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    is_admin: t.bool(),
    created_at: t.timestamp(),
  }
);

const score_entry = table(
  { name: 'score_entry', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    identity: t.identity().index('btree'),
    name: t.string(),
    score: t.u64(),
    dist_m: t.u32(),
    duration_s: t.u32(),
    at: t.timestamp(),
  }
);

const ghost = table(
  { name: 'ghost', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    score: t.u64(),
    dist_m: t.u32(),
    data: t.string(), // base64-encoded frame stream
    at: t.timestamp(),
  }
);

const grant = table(
  { name: 'grant', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    admin: t.identity(),
    target_name: t.string(),
    kind: t.string(),  // "skin" | "goal" | "coins" | "gems" | "note"
    value: t.string(),
    at: t.timestamp(),
  }
);

const live_pos = table(
  { name: 'live_pos', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    dist_m: t.u32(),
    at_ms: t.u64(), // client clock; used only for stale-row cleanup + display
  }
);

const lobby = table(
  { name: 'lobby', public: true },
  {
    code: t.string().primaryKey(),
    host: t.string(),
    seed: t.u64(),
    state: t.string(), // "open" | "running"
    created_ms: t.u64(),
  }
);

const lobby_member = table(
  { name: 'lobby_member', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string(),
    name: t.string(),
    identity: t.identity(),
    at_ms: t.u64(),
  }
);

const mp_pos = table(
  { name: 'mp_pos', public: true },
  {
    identity: t.identity().primaryKey(),
    code: t.string(),
    name: t.string(),
    x: t.f32(),
    y: t.f32(),
    z: t.f32(),
    dist_m: t.u32(),
    at_ms: t.u64(),
  }
);

const app_settings = table(
  { name: 'app_settings', public: true },
  {
    id: t.u32().primaryKey(),
    allow_registration: t.bool(),
  }
);

const spacetimedb = schema({ player, score_entry, ghost, grant, live_pos, lobby, lobby_member, mp_pos, app_settings });
export default spacetimedb;

/* ============================== helpers ============================== */

const MAX_NAME = 24;
const MAX_GHOST_CHARS = 250_000;
const KEEP_RUNS_PER_PLAYER = 20;

function idEq(a: unknown, b: unknown): boolean {
  // Identity equality — toHexString() if available, String() otherwise.
  const ax = (a as any)?.toHexString ? (a as any).toHexString() : String(a);
  const bx = (b as any)?.toHexString ? (b as any).toHexString() : String(b);
  return ax === bx;
}

function findPlayer(ctx: any) {
  for (const row of ctx.db.player.iter()) {
    if (idEq(row.identity, ctx.sender)) return row;
  }
  return null;
}

function requireAdmin(ctx: any) {
  const me = findPlayer(ctx);
  if (!me || !me.is_admin) throw new Error('admin only');
  return me;
}

function registrationAllowed(ctx: any): boolean {
  for (const row of ctx.db.app_settings.iter()) return row.allow_registration;
  return true; // default open until the admin flips it
}

function nameTaken(ctx: any, name: string, exceptIdentity: unknown): boolean {
  const low = name.toLowerCase();
  for (const row of ctx.db.player.iter()) {
    if (row.name.toLowerCase() === low && !idEq(row.identity, exceptIdentity)) return true;
  }
  return false;
}

function cleanName(name: string): string {
  const n = (name || '').trim().slice(0, MAX_NAME);
  return n.length ? n : 'Boulder';
}

/* ============================== reducers ============================== */

export const register_player = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const existing = findPlayer(ctx);
  const display = cleanName(name);
  if (nameTaken(ctx, display, ctx.sender)) throw new Error('name taken');
  if (existing) {
    ctx.db.player.identity.update({ ...existing, name: display });
    return;
  }
  // The very first player to ever register becomes the admin.
  let any = false;
  for (const _ of ctx.db.player.iter()) { any = true; break; }
  if (any && !registrationAllowed(ctx)) throw new Error('registration disabled');
  ctx.db.player.insert({
    identity: ctx.sender,
    name: display,
    is_admin: !any,
    created_at: ctx.timestamp,
  });
});

export const set_name = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const me = findPlayer(ctx);
  if (!me) throw new Error('register first');
  const display = cleanName(name);
  if (nameTaken(ctx, display, ctx.sender)) throw new Error('name taken');
  ctx.db.player.identity.update({ ...me, name: display });
});

export const submit_run = spacetimedb.reducer(
  { score: t.u64(), dist_m: t.u32(), duration_s: t.u32() },
  (ctx, { score, dist_m, duration_s }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');

    /* server-side sanity validation — the client can never be trusted */
    const sc = Number(score);
    if (duration_s < 5) throw new Error('run too short');
    if (duration_s > 6 * 3600) throw new Error('run too long');
    if (dist_m > duration_s * 70) throw new Error('impossible distance');
    if (sc > duration_s * 120_000) throw new Error('impossible score');
    if (sc < 0 || dist_m < 0) throw new Error('bad values');

    ctx.db.score_entry.insert({
      id: 0n,
      identity: ctx.sender,
      name: me.name,
      score,
      dist_m,
      duration_s,
      at: ctx.timestamp,
    });

    // keep only the player's best KEEP_RUNS_PER_PLAYER rows (by score)
    const mine: any[] = [];
    for (const row of ctx.db.score_entry.iter()) {
      if (idEq(row.identity, ctx.sender)) mine.push(row);
    }
    if (mine.length > KEEP_RUNS_PER_PLAYER) {
      mine.sort((a, b) => Number(a.score) - Number(b.score));
      for (let i = 0; i < mine.length - KEEP_RUNS_PER_PLAYER; i++) {
        ctx.db.score_entry.id.delete(mine[i].id);
      }
    }
  }
);

export const save_ghost = spacetimedb.reducer(
  { data: t.string(), score: t.u64(), dist_m: t.u32() },
  (ctx, { data, score, dist_m }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');
    if (data.length > MAX_GHOST_CHARS) throw new Error('ghost too large');
    const existing = (() => {
      for (const row of ctx.db.ghost.iter()) if (idEq(row.identity, ctx.sender)) return row;
      return null;
    })();
    const row = { identity: ctx.sender, name: me.name, score, dist_m, data, at: ctx.timestamp };
    if (existing) ctx.db.ghost.identity.update(row);
    else ctx.db.ghost.insert(row);
  }
);

/* --------------------------- multiplayer --------------------------- */

export const update_pos = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), dist_m: t.u32(), at_ms: t.u64() },
  (ctx, { x, y, z, dist_m, at_ms }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');
    const row = { identity: ctx.sender, name: me.name, x, y, z, dist_m, at_ms };
    let exists = false;
    for (const r of ctx.db.live_pos.iter()) { if (idEq(r.identity, ctx.sender)) { exists = true; break; } }
    if (exists) ctx.db.live_pos.identity.update(row);
    else ctx.db.live_pos.insert(row);
    // prune rows stale for >30 s (by the freshest client clock we have)
    const cutoff = at_ms - 30_000n;
    const stale: any[] = [];
    for (const r of ctx.db.live_pos.iter()) {
      if (!idEq(r.identity, ctx.sender) && r.at_ms < cutoff) stale.push(r.identity);
    }
    for (const id of stale) ctx.db.live_pos.identity.delete(id);
  }
);

export const leave_live = spacetimedb.reducer({}, (ctx, _args) => {
  for (const r of ctx.db.live_pos.iter()) {
    if (idEq(r.identity, ctx.sender)) { ctx.db.live_pos.identity.delete(r.identity); return; }
  }
});

/* --------------------------- lobby multiplayer --------------------------- */

const LOBBY_TTL_MS = 2n * 3600n * 1000n;

function dropLobby(ctx: any, code: string) {
  const memIds: any[] = [];
  for (const m of ctx.db.lobby_member.iter()) if (m.code === code) memIds.push(m.id);
  for (const id of memIds) ctx.db.lobby_member.id.delete(id);
  const posIds: any[] = [];
  for (const p of ctx.db.mp_pos.iter()) if (p.code === code) posIds.push(p.identity);
  for (const id of posIds) ctx.db.mp_pos.identity.delete(id);
  for (const l of ctx.db.lobby.iter()) if (l.code === code) { ctx.db.lobby.code.delete(code); break; }
}

function pruneLobbies(ctx: any, now_ms: bigint) {
  const dead: string[] = [];
  for (const l of ctx.db.lobby.iter()) if (l.created_ms < now_ms - LOBBY_TTL_MS) dead.push(l.code);
  for (const c of dead) dropLobby(ctx, c);
}

function removeMyMemberships(ctx: any) {
  const ids: any[] = [];
  for (const m of ctx.db.lobby_member.iter()) if (idEq(m.identity, ctx.sender)) ids.push(m.id);
  for (const id of ids) ctx.db.lobby_member.id.delete(id);
  for (const p of ctx.db.mp_pos.iter()) if (idEq(p.identity, ctx.sender)) { ctx.db.mp_pos.identity.delete(p.identity); break; }
}

export const create_lobby = spacetimedb.reducer(
  { code: t.string(), seed: t.u64(), at_ms: t.u64() },
  (ctx, { code, seed, at_ms }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');
    pruneLobbies(ctx, at_ms);
    const c = code.toUpperCase().slice(0, 8);
    for (const l of ctx.db.lobby.iter()) if (l.code === c) throw new Error('code taken');
    removeMyMemberships(ctx);
    ctx.db.lobby.insert({ code: c, host: me.name, seed, state: 'open', created_ms: at_ms });
    ctx.db.lobby_member.insert({ id: 0n, code: c, name: me.name, identity: ctx.sender, at_ms });
  }
);

export const join_lobby = spacetimedb.reducer(
  { code: t.string(), at_ms: t.u64() },
  (ctx, { code, at_ms }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');
    const c = code.toUpperCase().slice(0, 8);
    let found = null as any;
    for (const l of ctx.db.lobby.iter()) if (l.code === c) { found = l; break; }
    if (!found) throw new Error('lobby not found');
    removeMyMemberships(ctx);
    ctx.db.lobby_member.insert({ id: 0n, code: c, name: me.name, identity: ctx.sender, at_ms });
  }
);

export const start_lobby = spacetimedb.reducer({ code: t.string() }, (ctx, { code }) => {
  const me = findPlayer(ctx);
  if (!me) throw new Error('register first');
  const c = code.toUpperCase().slice(0, 8);
  for (const l of ctx.db.lobby.iter()) {
    if (l.code === c) {
      if (l.host !== me.name) throw new Error('host only');
      ctx.db.lobby.code.update({ ...l, state: 'running' });
      return;
    }
  }
  throw new Error('lobby not found');
});

export const leave_lobby = spacetimedb.reducer({}, (ctx, _args) => {
  const me = findPlayer(ctx);
  if (!me) return;
  // if I host an open/running lobby, the lobby dies with me
  for (const l of ctx.db.lobby.iter()) if (l.host === me.name) { dropLobby(ctx, l.code); }
  removeMyMemberships(ctx);
});

export const update_mp = spacetimedb.reducer(
  { code: t.string(), x: t.f32(), y: t.f32(), z: t.f32(), dist_m: t.u32(), at_ms: t.u64() },
  (ctx, { code, x, y, z, dist_m, at_ms }) => {
    const me = findPlayer(ctx);
    if (!me) throw new Error('register first');
    const row = { identity: ctx.sender, code: code.toUpperCase().slice(0, 8), name: me.name, x, y, z, dist_m, at_ms };
    let exists = false;
    for (const r of ctx.db.mp_pos.iter()) { if (idEq(r.identity, ctx.sender)) { exists = true; break; } }
    if (exists) ctx.db.mp_pos.identity.update(row);
    else ctx.db.mp_pos.insert(row);
    const cutoff = at_ms - 30_000n;
    const stale: any[] = [];
    for (const r of ctx.db.mp_pos.iter()) if (!idEq(r.identity, ctx.sender) && r.at_ms < cutoff) stale.push(r.identity);
    for (const id of stale) ctx.db.mp_pos.identity.delete(id);
  }
);

/* ----------------------------- admin ----------------------------- */

export const admin_set_admin = spacetimedb.reducer({ target_name: t.string(), value: t.bool() }, (ctx, { target_name, value }) => {
  requireAdmin(ctx);
  for (const row of ctx.db.player.iter()) {
    if (row.name === target_name) {
      ctx.db.player.identity.update({ ...row, is_admin: value });
      return;
    }
  }
  throw new Error('player not found');
});

export const admin_delete_scores = spacetimedb.reducer({ target_name: t.string() }, (ctx, { target_name }) => {
  requireAdmin(ctx);
  const ids: any[] = [];
  for (const row of ctx.db.score_entry.iter()) if (row.name === target_name) ids.push(row.id);
  for (const id of ids) ctx.db.score_entry.id.delete(id);
});

export const admin_ping = spacetimedb.reducer({}, (ctx, _args) => {
  requireAdmin(ctx); // throws for everyone who isn't admin -> the admin UI gates on this
});

export const admin_set_registration = spacetimedb.reducer({ value: t.bool() }, (ctx, { value }) => {
  requireAdmin(ctx);
  let exists = false;
  for (const row of ctx.db.app_settings.iter()) { exists = true; break; }
  if (exists) ctx.db.app_settings.id.update({ id: 0, allow_registration: value });
  else ctx.db.app_settings.insert({ id: 0, allow_registration: value });
});

export const admin_delete_ghost = spacetimedb.reducer({ target_name: t.string() }, (ctx, { target_name }) => {
  requireAdmin(ctx);
  for (const row of ctx.db.ghost.iter()) {
    if (row.name === target_name) { ctx.db.ghost.identity.delete(row.identity); return; }
  }
});

export const admin_grant = spacetimedb.reducer({ target_name: t.string(), kind: t.string(), value: t.string() }, (ctx, { target_name, kind, value }) => {
  const admin = requireAdmin(ctx);
  ctx.db.grant.insert({
    id: 0n,
    admin: admin.identity,
    target_name: cleanName(target_name),
    kind: kind.slice(0, 16),
    value: value.slice(0, 64),
    at: ctx.timestamp,
  });
});
