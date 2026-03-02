# Boulder Rampage (Babylon.js WebGL prototype)

Prepracovaný prototyp beží na **Babylon.js**.

## Spustenie lokálne (bez npm)

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Spustenie cez Gist (single-file)

Repo teraz obsahuje aj `gist.html` — kompletný self-contained build (HTML+CSS+JS+data v jednom súbore).

Postup:
1. Vytvor nový public gist a vlož obsah `gist.html`.
2. Spusti cez URL wrapper, napr.:
   - `https://htmlpreview.github.io/?<RAW_GIST_URL>` alebo
   - `https://gistcdn.githack.com/<user>/<gist-id>/raw/gist.html`

> Toto je najspoľahlivejšia cesta, keď je `npm install` v prostredí blokovaný (403).

## Implementované

- Babylon.js 3D endless roller s downhill pohybom, drift/inertia a jump hop.
- Chunk typy + procedural generation + fairness validator.
- Scoring + multiplier + meter + Overdrive + grace window.
- Hazards/destructibles/pickups + pooling/recyklácia objektov.
- Meta: coins/gems, spinner buffy, upgrady, continue flow, goals progres.
- Save/load localStorage + export/import JSON.
- Mobile: gyro + tap + virtuálny joystick fallback.

## Súbory

- `index.html` — canvas + HUD/UI
- `style.css` — štýly
- `src/game.js` — Babylon runtime (multi-file)
- `gist.html` — single-file Gist-ready build
- `data/*.json` + `public/data/*.json` — konfigurácia
