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


## Spustenie priamo na GitHub Pages (GH web)

1. Pushni repo na GitHub.
2. V GitHub repozitári choď do **Settings → Pages** a nastav **Source = GitHub Actions**.
3. Workflow `.github/workflows/pages.yml` sa spustí po pushi (alebo ručne cez Actions).
4. URL bude: `https://<tvoj-user>.github.io/<repo>/`
   - Multi-file build: `https://<tvoj-user>.github.io/<repo>/index.html`
   - Gist-like single-file build: `https://<tvoj-user>.github.io/<repo>/gist.html`

Ak používaš branch `work`, workflow je už nastavený aj na ňu.

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
