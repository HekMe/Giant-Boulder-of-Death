# 🪨 ROCKFALL — nekonečný zjazd balvanu

Balvan padá z neba, dopadne na horský svah a valí sa dole — stále rýchlejšie, cez päť biomov, ponad trhliny, pomedzi ostne, míny a valiace sa skaly. Rozbíjaj objekty, zbieraj mince a drahokamy, nabíjaj Overdrive a posúvaj sa stromom cieľov k novým skinom.

Celá hra je postavená na **Babylon.js** (CDN) + čistom HTML/CSS/JS. Žiadny build krok, žiadne externé assety — všetka grafika aj zvuk sú procedurálne.

## ✨ Čo hra obsahuje

- **Cinematický intro pád z neba** — kamera sa počas pádu presunie za balvan, dopad so screen shake a prachom.
- **Nekonečný procedurálny terén** — svah sa vlní, kľukatí a nakláňa; po oboch stranách kaňonové steny.
- **Trhliny (gaps)** — telegrafované varovnými značkami, dajú sa preskočiť (Space / tlačidlo skoku); pád dnu = koniec behu.
- **5 biomov** — alpská lúka → skaly → sneh a ľad → vulkán → súmrak; plynulé blendovanie farieb, hmly aj fyziky (ľad šmýka).
- **10 rozbitných objektov** — od plota a sena až po zlatý idol, každý s vlastnou hodnotou.
- **Hazardy** — ostne, míny a valiace sa balvany; vždy existuje bezpečná dráha a rozostupy rešpektujú reakčný čas.
- **Skóre, kombo, meter, Overdrive** — near-miss a gap-clear bonusy, dočasná nesmrteľnosť pri plnom metri.
- **Meta progresia** — mince a drahokamy, 6 permanentných upgradov, gem ruleta s buffmi, 15 sekvenčných cieľov, 4 odomykateľné skiny, continue po smrti s rastúcou cenou, doživotné štatistiky.
- **Ukladanie** — localStorage + export/import save súboru (JSON).
- **Mobil aj desktop** — virtuálny joystick, tlačidlo skoku, voliteľný gyroskop; nastavenia citlivosti, hlasitosti, kvality a reduced-motion.
- **Procedurálny zvuk** — Web Audio API, žiadne audio súbory.

## 🎮 Ovládanie

| Akcia | Desktop | Mobil |
|---|---|---|
| Riadenie | A / D alebo ← / → | joystick vľavo (alebo gyro) |
| Skok | Space | tlačidlo vpravo |
| Pauza | Esc alebo ⏸ | ⏸ |

## 🚀 Spustenie lokálne

Hra načítava JSON konfigy cez `fetch`, takže ju **nespúšťaj cez `file://`** — potrebuje HTTP server:

```bash
# Python
python3 -m http.server 8080
# alebo Node
npx serve .
```

Potom otvor `http://localhost:8080`.

**Núdzové riešenie:** súbor `standalone.html` má všetko (CSS, konfigy aj kód) vložené priamo v sebe — funguje aj otvorený priamo z disku (stále potrebuje internet kvôli Babylon CDN).

## 🌐 Nasadenie na GitHub Pages

1. Vytvor nový repozitár na GitHube.
2. Nahraj **celý obsah** tohto priečinka do koreňa repozitára (vrátane skrytého `.github/`).
3. V repozitári otvor **Settings → Pages** a v sekcii **Source** zvoľ **GitHub Actions**.
4. Po pushi na vetvu `main` sa workflow `Deploy to GitHub Pages` spustí sám (dá sa spustiť aj ručne cez záložku Actions → Run workflow).
5. Hra bude bežať na `https://<tvoje-meno>.github.io/<repo>/`.

## 📁 Štruktúra projektu

```
.
├── index.html              # UI, HUD, overlaye, mobilné ovládanie
├── style.css               # tmavá „stone & ember“ vizuálna identita
├── game.js                 # celá logika hry (jeden súbor, bez importov)
├── standalone.html         # samostatná verzia so všetkým inline
├── config/                 # data-driven balans hry
│   ├── balance.json        # fyzika, terén, trhliny, hazardy, skóre, kamera
│   ├── objects.json        # 10 rozbitných objektov
│   ├── biomes.json         # 5 biomov (palety, hmla, grip, dekorácie)
│   ├── upgrades.json       # 6 permanentných upgradov
│   ├── spinner.json        # gem ruleta a buffy
│   └── goals.json          # 15 cieľov + skiny
├── public/config/          # zrkadlová kópia konfigov (záložná cesta)
└── .github/workflows/
    └── pages.yml           # automatický deploy na GitHub Pages
```

`game.js` skúša konfigy načítať z viacerých ciest (`config/`, `./config/`, `public/config/`, …), takže funguje v koreni domény aj v podpriečinku Pages. Ak existuje `window.__INLINE_CONFIG__` (standalone verzia), fetch sa preskočí úplne.

## 🏔️ Ako funguje terén, trhliny a biomy

- **`centerX(z)`** — stred trate ako súčet sínusoviek; trať sa tým kľukatí. Steny, objekty aj kamera sa od neho odvíjajú.
- **`terrainY(x, z)`** — výška terénu: základný klesajúci profil + vlny + naklonenie do zákrut (banked chute) + jemné zvlnenie. Tú istú funkciu používa mesh terénu aj fyzika balvanu, takže balvan vždy „sedí“ presne na zemi.
- **Gap mapa** — trhliny sú deterministické: pozícia a šírka každej sa počíta hashom z indexu segmentu. Mesh terénu pri generovaní jednoducho vynechá trojuholníky v oblasti trhliny (vznikne skutočná diera) a fyzika sa pýta tej istej mapy, či je pod balvanom zem.
- **Biome blending** — každý biome má paletu, hustotu hmly, grip a dekorácie. Na hraniciach sa všetko lineárne mieša v prechodovej zóne, vrátane vertex farieb terénu — prechody sú preto plynulé, nie strihané.

## 🛠️ Technické poznámky

- Babylon.js sa načítava z `https://cdn.babylonjs.com/babylon.js` ako globál — `game.js` je ES module bez importov.
- Object pooling pre skaly, objekty, hazardy, mince a debris; staré chunky sa korektne dispose-ujú.
- Delta time je clampnutý, takže lag spike hru nerozbije.
- Pri zlyhaní štartu sa zobrazí overlay s popisom chyby namiesto čiernej obrazovky.

Príjemné gúľanie! 🪨💨
