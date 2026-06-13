# ROCK&ROLL — master backlog (everything the user has asked for)

This file tracks the FULL scope the user wants. Items get checked off as they ship.
The user has confirmed: **all of these will eventually be done.**

## BLOCK 1 — HUD + Menu overhaul  (DONE ✅)
- [x] Rename the whole game to **Rock&Roll**
- [x] Effect icons stacked on the RIGHT, each with a shrinking ring showing remaining duration
- [x] Overdrive shown as a BAR on the LEFT: fills upward as meter charges; while in Overdrive
      it drains top→down as the duration runs out
- [x] Pause screen lists active effects + remaining time for each
- [x] Settings adjustable DURING a run (from the pause menu)
- [x] Menu restructure: fewer top-level buttons. Proposed grouping:
      - **Shop** (tabs: Upgrades / Temporary items / Customization[skins+trails+boulders])
      - **Stats & Leaderboard** (combined)
      - core: Start, Multiplayer, Ghosts, Tutorial, Settings, Save
- [x] **Tutorial** menu explaining every feature
- [x] Mobile menu is far too large — compact layout, fits a phone screen

## BLOCK 2 — Cloud sync + admin-configurable spawn  (DONE ✅)
- [x] Coins, diamonds (gems), and unlocks SYNC with the account (cloud save)
- [x] Admin can configure EVERYTHING about spawning: amount of objects/enemies,
      score values, rarity, spawn frequency — all of it, live, no redeploy
- [x] Admin config persists in the DB and is fetched by all clients

## BLOCK 3 — Gameplay + graphics overhaul  (DONE ✅)
- [x] Professional-level graphical overhaul; the game must feel pro-grade
- [x] Each biome must clearly read as a special region (distinct, immersive)
- [x] Enemies and destructibles genuinely elaborate and themed to their zone
- [x] Some destructibles MOVE (animated/moving smash targets)
- [x] Slower progression: more low-score common things (sheep, fences) for less,
      rare high-value finds (yeti, limousine) for much more
- [x] Crevasses can run ALONG the length too, not only across the width
- [x] The far side of a crevasse must NOT be higher than the near side
- [x] Enemies placed more randomly — right now they line up in a single row

## CROSS-CUTTING / SMALLER (fold into the blocks above where they fit)
- [x] "Show me I'm in a special region" visual cues per biome (part of Block 3)
- [x] Everything spawn-related must be admin-tunable (Block 2 covers the data;
      Block 3 may add more knobs as new content lands)

## DONE (recent)
- [x] Graphics overhaul: ACES tone mapping + bloom + FXAA + vignette, glow layer,
      3-light rig, gradient sky dome per biome, blurred shadows, richer materials
- [x] Biome atmosphere particles (snow/ash/sparkles/pollen) following the boulder
- [x] Region-entry banner showing biome name + rarity
- [x] Moving destructibles (graze/hop/sway/spin) + creature models (sheep/deer/penguin/boar/critters)
- [x] Ghost saving bug (object vs array .length) fixed
- [x] Refresh-logout bug fixed
- [x] No pause during multiplayer races
- [x] Spectator mode after dying in a race
- [x] Fair-race upgrade levelling (everyone capped to the weakest racer per-upgrade)
- [x] Lobby multiplayer (host code + join), race results standings
- [x] Full replay ghosts (events: smashes/pickups/gates/overdrive...)
- [x] Unique usernames, admin-only admin page, registration toggle
