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

const spacetimedb = schema({ player, score_entry, ghost, grant, live_pos });
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

function cleanName(name: string): string {
  const n = (name || '').trim().slice(0, MAX_NAME);
  return n.length ? n : 'Boulder';
}

/* ============================== reducers ============================== */

export const register_player = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const existing = findPlayer(ctx);
  const display = cleanName(name);
  if (existing) {
    ctx.db.player.identity.update({ ...existing, name: display });
    return;
  }
  // The very first player to ever register becomes the admin.
  let any = false;
  for (const _ of ctx.db.player.iter()) { any = true; break; }
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
  ctx.db.player.identity.update({ ...me, name: cleanName(name) });
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
