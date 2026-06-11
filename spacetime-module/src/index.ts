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

const spacetimedb = schema({ player, score_entry, ghost, grant });
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

spacetimedb.reducer('register_player', { name: t.string() }, (ctx, { name }) => {
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

spacetimedb.reducer('set_name', { name: t.string() }, (ctx, { name }) => {
  const me = findPlayer(ctx);
  if (!me) throw new Error('register first');
  ctx.db.player.identity.update({ ...me, name: cleanName(name) });
});

spacetimedb.reducer(
  'submit_run',
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

spacetimedb.reducer(
  'save_ghost',
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

/* ----------------------------- admin ----------------------------- */

spacetimedb.reducer('admin_set_admin', { target_name: t.string(), value: t.bool() }, (ctx, { target_name, value }) => {
  requireAdmin(ctx);
  for (const row of ctx.db.player.iter()) {
    if (row.name === target_name) {
      ctx.db.player.identity.update({ ...row, is_admin: value });
      return;
    }
  }
  throw new Error('player not found');
});

spacetimedb.reducer('admin_delete_scores', { target_name: t.string() }, (ctx, { target_name }) => {
  requireAdmin(ctx);
  const ids: any[] = [];
  for (const row of ctx.db.score_entry.iter()) if (row.name === target_name) ids.push(row.id);
  for (const id of ids) ctx.db.score_entry.id.delete(id);
});

spacetimedb.reducer('admin_grant', { target_name: t.string(), kind: t.string(), value: t.string() }, (ctx, { target_name, kind, value }) => {
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
