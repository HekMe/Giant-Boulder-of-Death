# Boulder Rampage (Babylon.js WebGL prototype)

Prepracovaný prototyp teraz beží na **Babylon.js** (nie Three.js), podľa tvojej požiadavky.

## Spustenie (bez npm)

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Implementované

- Babylon.js 3D endless roller s downhill pohybom, drift/inertia a jump hop.
- Chunk typy + procedural generation + fairness validator (reaction distance + safe lane).
- Scoring + multiplier + meter + Overdrive + grace window.
- Hazards/destructibles/pickups + pooling/recyklácia objektov.
- Meta: coins/gems, spinner buffy, upgrady, continue flow, goals progres.
- Save/load localStorage + export/import JSON.
- Mobile: gyro + tap + virtuálny joystick fallback.

## Poznámka k preview

`npm install` môže v tomto prostredí padať na 403, preto je odporúčaná cesta Python static server.

## Súbory

- `index.html` — canvas + HUD/UI
- `style.css` — štýly
- `src/game.js` — Babylon runtime
- `data/*.json` + `public/data/*.json` — konfigurácia
