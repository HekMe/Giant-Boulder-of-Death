# Boulder Rampage

A 3D endless downhill roller built with [Babylon.js](https://www.babylonjs.com/) and
plain WebGL. You steer a boulder racing down a continuously generated mountainside,
smashing destructibles, dodging hazards, and chaining destruction to trigger Overdrive.

All geometry, levels, and content are generated procedurally at runtime. The project
contains no third-party art, audio, or branded assets.

## Gameplay

- Roll downhill at ever-increasing speed; the steeper the slope, the faster you go.
- Smash destructibles to score points and charge the Overdrive meter.
- Hitting a full meter triggers **Overdrive**: a temporary state where hazards become
  destructible and scoring is boosted.
- Touching a hazard ends the run unless you have a grace window active.
- Collect coins (spent on permanent upgrades) and gems (spent on the spinner and continues).

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | `A` / `D` or arrow keys | Virtual joystick (bottom-left) |
| Jump  | `Space` | Jump button / tap right side |

On mobile, device-orientation (gyro) tilt is used for steering when available, with the
joystick as a fallback. Jumping clears low ground hazards if timed well.

## Run it locally

The game must be served over HTTP (not opened as a `file://` URL), because it loads
JSON config and an ES module.

```bash
# Any static server works. With Python:
python3 -m http.server 8000
# then open http://localhost:8000
```

There are two equivalent builds:

- **`index.html`** — modular build. Loads `src/game.js` and reads config from `data/*.json`.
- **`gist.html`** — single-file build with all config inlined. Useful for pasting into a
  gist or any host where you want one file. Still needs an HTTP server (ES features / CDN).

## Deploy to GitHub Pages

A workflow is included at `.github/workflows/pages.yml`.

1. In your repository, go to **Settings → Pages → Build and deployment** and set
   **Source: GitHub Actions**.
2. Push to `main`, `master`, or `work`. The workflow builds and deploys automatically.
   (You can also trigger it manually from **Actions → Deploy static site to GitHub Pages
   → Run workflow**.)
3. The game will be live at `https://<username>.github.io/<repository>/`.

## Project structure

```
.
├── index.html              # Modular build (canvas + HUD/UI)
├── gist.html               # Single-file build with inlined config
├── style.css               # UI styling
├── src/
│   └── game.js             # Babylon.js runtime: terrain, physics, gameplay loop
├── data/                   # Config read by index.html (relative path)
│   ├── balance.json        # Physics, scoring, and spawn-density tuning
│   ├── objects.json        # Destructibles, hazards, pickups
│   ├── goals.json          # Goal tree and rewards
│   ├── upgrades.json       # Permanent upgrade costs and bonuses
│   ├── spinners.json       # Spinner buffs and rare events
│   └── themes.json         # Theme definitions
├── public/data/            # Same config, mirrored for hosts that serve from /public
├── package.json            # Optional Vite dev/build scripts
└── .github/workflows/
    └── pages.yml           # GitHub Pages deploy workflow
```

## How the 3D terrain works

The level is a single continuous heightfield rather than discrete flat platforms.

- `centerX(z)` defines the winding centreline of the path as it descends.
- `terrainY(x, z)` returns the surface height: an overall downhill grade, large rolling
  hills, a gently banked chute that keeps the boulder centred, and small surface ripples.

The world is streamed as 45-metre chunks ahead of the player. Each chunk builds a
subdivided ribbon mesh sampled from those two functions, so the ground genuinely slopes
and rolls. Chunks behind the player are disposed to keep memory flat. The boulder follows
the surface height every frame, accelerates based on the local slope steepness, and the
chase camera sits uphill-and-behind looking down the descent.

## Configuration

Tuning lives entirely in the JSON files (and the inlined `DATA` block in `gist.html`).
Adjust `data/balance.json` to change physics feel, scoring, and how densely each phase of
a run spawns objects. Edit both `data/` and `public/data/` (or re-copy one to the other)
to keep the two locations in sync.

## Save data

Progress (currencies, upgrades, completed goals, and stats) is stored in `localStorage`.
Use **Export Save** to download a JSON backup and **Import Save** to restore it. The
modular and single-file builds use separate save keys, so they do not share progress.

## Tech notes

- Babylon.js is loaded from the official CDN. For fully offline play, host the library
  locally and update the script reference.
- No build step is required to play; `package.json` only provides optional Vite scripts
  for a dev server.

## License

You own this code and its procedurally generated content. Add a license file (for example
MIT) if you intend to share or open-source it.
