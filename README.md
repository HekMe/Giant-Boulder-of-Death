# 🪨 ROCKFALL — endless downhill boulder run

A boulder drops out of the sky, slams into a mountainside and rolls downhill — faster and faster, through five biomes, over crevasses, between spikes, mines and rolling rocks. Smash objects, collect coins and gems, charge your Overdrive and work through the goal tree to unlock new boulder skins.

Built entirely with **Babylon.js** (CDN) + plain HTML/CSS/JS. No build step, no external assets — all graphics and sound are procedural.

## ✨ Features

- **Cinematic sky-drop intro** — the camera swings behind the boulder mid-fall; impact lands with screen shake and a dust burst.
- **Endless procedural terrain** — the slope rolls, winds and banks; both edges are sealed by a continuous, solid rocky wall surface (with a jagged rim and boulders on top) — the wall face sits exactly at the physics boundary, so what you see is what stops you.
- **Crevasses (gaps)** — telegraphed by warning stripes, jumpable (Space / jump button); falling in ends the run.
- **12 biomes with rarity tiers** — five common, four rare, two epic and one legendary, picked zone-by-zone with a per-run seed; each biome favors its own destructibles and enemies, and rarer biomes drop more coins. Colors, fog and physics blend smoothly (ice is slippery).
- **~290 biome-exclusive destructibles** — every biome has its own pool of ~24 themed variants (Frosted barrels in the snow, Gilded idols in the ruins, Mossy huts in the swamp…); heavier objects slow the boulder more on impact — except during Overdrive. Every kill is recorded per biome in the **Encyclopedia**.
- **10 enemy types** — spikes, mines, rolling boulders, lava pools, homing stalkers, thorn strips, spinning blades, stomping crushers, erupting geysers and falling icicles. Each biome fields its own weighted roster of up to 6; the red ring is a *warning zone* — only the enemy's body kills. Crushers and geysers cycle between safe and lethal phases; icicles drop when you approach.
- **Score, combo, meter, Overdrive** — near-miss and gap-clear bonuses, temporary invincibility at full meter.
- **Power-ups & boost rings** — rare track pickups (Super Jump, ×2 Score & Coins, Steer Boost, Mega Magnet) and floating rings that grant a burst of speed.
- **Meta progression** — coins and gems, 6 permanent upgrades, a gem-powered lucky spin with run buffs, 75 goals (5 active at a time, shown on the HUD), 9 boulder skins, 5 purchasable trail colors, a next-run item **Shop** (Stone Cloak shields, Coin Doubler, Lucky Charm), continue-after-death with a rising price, lifetime stats.
- **Saving** — localStorage plus export/import of your save as a JSON file.
- **Mobile and desktop** — the game detects mobile devices and enables **gyroscope (tilt) steering** automatically; a virtual joystick and a jump button are also available. Settings cover sensitivity, volume, quality and reduced motion.
- **Procedural sound & adaptive music** — Web Audio API, zero audio files; the ambient music retunes per biome (scale, root, tempo and pad all shift as you cross into a new zone).

## 🎮 Controls

| Action | Desktop | Mobile |
|---|---|---|
| Steer | A / D or ← / → | **tilt your device (gyro, on by default)** or the left joystick |
| Brake | S or ↓ | pull the joystick down |
| Jump | Space | big button on the right |
| Pause | Esc or ⏸ | ⏸ |

On mobile the gyroscope is enabled automatically. While you're touching the joystick, it takes priority over tilt. You can turn the gyro off in Settings. On iOS the browser asks for motion-sensor permission the first time you press START RUN.

## 🚀 Running locally

`index.html` is fully **self-contained** (CSS, config and code are inlined by the build script), so you can simply double-click it — no server needed. It only requires internet access for the Babylon.js CDN. `standalone.html` is an identical copy kept for convenience.

For development use `dev.html`, which loads `style.css`, `game.js` and the JSON configs as separate files. That one needs a tiny HTTP server:

```bash
python3 -m http.server 8080   # or: npx serve .
```

After editing any source file (`game.js`, `style.css`, `config/*.json`, `dev.html`), regenerate the bundled files:

```bash
node build.js
```

## 🌐 Deploying to GitHub Pages

1. Create a new repository on GitHub.
2. Upload the **entire contents** of this folder to the repository **root** (including the hidden `.github/` folder). The files must sit directly in the root — not inside a subfolder. Even if some files don't make it, `index.html` alone is enough for the game to run, since it's self-contained.
3. In the repository open **Settings → Pages** and under **Source** select **GitHub Actions**.
4. Every push to `main` triggers the `Deploy to GitHub Pages` workflow automatically (you can also run it manually from the Actions tab → Run workflow).
5. The game goes live at `https://<your-username>.github.io/<repo>/`.

## 📁 Project structure

```
.
├── index.html              # PLAYABLE BUILD — fully self-contained (generated by build.js)
├── standalone.html         # identical copy of the build
├── dev.html                # development page: loads the separate source files below
├── game.js                 # entire game logic (one file, no imports)
├── style.css               # dark "stone & ember" visual identity
├── build.js                # node build.js -> regenerates index/standalone/config.fallback
├── config.fallback.js      # bundled config copy for dev.html on file:// (generated)
├── config/                 # data-driven game balance (source of truth)
│   ├── balance.json        # physics, terrain, gaps, hazards, scoring, camera
│   ├── objects.json        # 22 destructible objects
│   ├── biomes.json         # 12 biomes (rarity, palettes, fog, grip, affinities)
│   ├── upgrades.json       # 12 permanent upgrades + next-run shop items
│   ├── spinner.json        # lucky spin buffs
│   └── goals.json          # 75 goals + skins + trails
├── public/config/          # mirror copy of configs (fallback fetch path)
└── .github/workflows/
    └── pages.yml           # automatic GitHub Pages deploy
```

`index.html` carries everything inline (`window.__INLINE_CONFIG__`), so it works anywhere — Pages root, subdirectory, or straight from disk. `dev.html` fetches configs from several paths (`config/`, `public/config/`, …) and falls back to `config.fallback.js` when fetch is unavailable.

## 🏔️ How the terrain, gaps and biomes work

- **`centerX(z)`** — the track centerline as a sum of sine waves; this makes the road wind. Walls, objects and the camera all derive from it.
- **`terrainY(x, z)`** — terrain height: a descending base profile + hills + banking into curves (banked chute) + fine ripples. The very same function drives the terrain mesh and the boulder physics, so the boulder always sits exactly on the ground.
- **Gap map** — crevasses are deterministic: each one's position and width are hashed from its segment index. The terrain mesh simply skips triangles inside a gap (a real hole appears), and the physics queries the same map to know whether there is ground under the boulder.
- **Biome blending** — every biome has a palette, fog density, grip and decor set. At borders everything is linearly blended across a transition zone, including the terrain's vertex colors — so transitions are smooth, never a hard cut.

## 🛠️ Technical notes

- Babylon.js loads from `https://cdn.babylonjs.com/babylon.js` as a global — `game.js` is a plain script with no imports.
- Object pooling for rocks, objects, hazards, coins and debris; old chunks are disposed properly.
- Delta time is clamped, so a lag spike won't break the simulation.
- If startup fails, an error overlay explains what went wrong instead of a black screen.

## 🌍 Online features (planned)

Accounts, global leaderboards, ghost replays, admin tools and live multiplayer are designed to run on **SpacetimeDB** — see `NETWORK.md` for the full setup checklist (OIDC via Google, GitHub secrets/variables, module tables and reducers). The game stays fully playable offline.

Happy rolling! 🪨💨
