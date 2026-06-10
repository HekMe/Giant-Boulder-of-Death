# 🪨 ROCKFALL — endless downhill boulder run

A boulder drops out of the sky, slams into a mountainside and rolls downhill — faster and faster, through five biomes, over crevasses, between spikes, mines and rolling rocks. Smash objects, collect coins and gems, charge your Overdrive and work through the goal tree to unlock new boulder skins.

Built entirely with **Babylon.js** (CDN) + plain HTML/CSS/JS. No build step, no external assets — all graphics and sound are procedural.

## ✨ Features

- **Cinematic sky-drop intro** — the camera swings behind the boulder mid-fall; impact lands with screen shake and a dust burst.
- **Endless procedural terrain** — the slope rolls, winds and banks; canyon rock walls line both edges.
- **Crevasses (gaps)** — telegraphed by warning stripes, jumpable (Space / jump button); falling in ends the run.
- **5 biomes** — alpine meadow → rocky peaks → snow and ice → volcanic → twilight; colors, fog and physics blend smoothly (ice is slippery).
- **10 destructible objects** — from a fence and hay bale up to a golden idol, each with its own value.
- **Hazards** — spikes, mines and rolling boulders; a safe lane always exists and spacing respects human reaction time.
- **Score, combo, meter, Overdrive** — near-miss and gap-clear bonuses, temporary invincibility at full meter.
- **Meta progression** — coins and gems, 6 permanent upgrades, a gem-powered lucky spin with run buffs, 15 sequential goals, 4 unlockable boulder skins, continue-after-death with a rising price, lifetime stats.
- **Saving** — localStorage plus export/import of your save as a JSON file.
- **Mobile and desktop** — the game detects mobile devices and enables **gyroscope (tilt) steering** automatically; a virtual joystick and a jump button are also available. Settings cover sensitivity, volume, quality and reduced motion.
- **Procedural sound** — Web Audio API, zero audio files.

## 🎮 Controls

| Action | Desktop | Mobile |
|---|---|---|
| Steer | A / D or ← / → | **tilt your device (gyro, on by default)** or the left joystick |
| Jump | Space | big button on the right |
| Pause | Esc or ⏸ | ⏸ |

On mobile the gyroscope is enabled automatically. While you're touching the joystick, it takes priority over tilt. You can turn the gyro off in Settings. On iOS the browser asks for motion-sensor permission the first time you press START RUN.

## 🚀 Running locally

The recommended way is a tiny HTTP server (the game loads its JSON configs via `fetch`):

```bash
# Python
python3 -m http.server 8080
# or Node
npx serve .
```

Then open `http://localhost:8080`.

Opening `index.html` straight from disk (`file://`) also works: when `fetch` is blocked, the game falls back to a bundled copy of the config (`config.fallback.js`). There's also `standalone.html`, a single file with everything (CSS, config and code) inlined. Both still need internet access for the Babylon.js CDN.

## 🌐 Deploying to GitHub Pages

1. Create a new repository on GitHub.
2. Upload the **entire contents** of this folder to the repository **root** (including the hidden `.github/` folder). The files `index.html`, `game.js` etc. must sit directly in the root — not inside a subfolder.
3. In the repository open **Settings → Pages** and under **Source** select **GitHub Actions**.
4. Every push to `main` triggers the `Deploy to GitHub Pages` workflow automatically (you can also run it manually from the Actions tab → Run workflow).
5. The game goes live at `https://<your-username>.github.io/<repo>/`.

## 📁 Project structure

```
.
├── index.html              # UI, HUD, overlays, mobile controls
├── style.css               # dark "stone & ember" visual identity
├── game.js                 # entire game logic (one file, no imports)
├── config.fallback.js      # bundled config copy, used only when fetch fails (file://)
├── standalone.html         # single-file version with everything inlined
├── config/                 # data-driven game balance
│   ├── balance.json        # physics, terrain, gaps, hazards, scoring, camera
│   ├── objects.json        # 10 destructible objects
│   ├── biomes.json         # 5 biomes (palettes, fog, grip, decor)
│   ├── upgrades.json       # 6 permanent upgrades
│   ├── spinner.json        # lucky spin buffs
│   └── goals.json          # 15 goals + skins
├── public/config/          # mirror copy of configs (fallback path)
└── .github/workflows/
    └── pages.yml           # automatic GitHub Pages deploy
```

`game.js` tries several config paths (`config/`, `./config/`, `public/config/`, …) so it works at a domain root as well as in a Pages subdirectory. If `window.__INLINE_CONFIG__` exists (standalone version) fetching is skipped entirely; if every fetch fails, `window.__FALLBACK_CONFIG__` from `config.fallback.js` is used.

> Note: after editing `config/*.json`, regenerate `config.fallback.js` (and `standalone.html` if you use it) or they'll keep the old values.

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

Happy rolling! 🪨💨
