# ROCKFALL server module (SpacetimeDB 2.0, TypeScript)

First-time local check (recommended before relying on CI):

    spacetime init --lang typescript /tmp/probe   # compare scaffold with this folder
    cd spacetime-module && npm install
    spacetime login
    spacetime publish <DB_NAME> --project-path .

Notes:
- `register_player` makes the FIRST registered identity the admin.
- `submit_run` validates score/distance against duration server-side.
- If the SDK's table accessor API differs from `ctx.db.<table>.identity.update(...)` /
  `.id.delete(...)` in your installed version, `spacetime publish` will fail with a clear
  type error — adjust those few call sites to match the scaffold from `spacetime init`.
  
