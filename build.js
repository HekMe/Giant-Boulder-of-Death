#!/usr/bin/env node
/* ROCKFALL build script.
   Inlines style.css + config/*.json + game.js into a single self-contained HTML.
   Outputs: index.html, standalone.html (identical), config.fallback.js.
   Run after editing any source file:  node build.js                              */
"use strict";
const fs = require("fs");

const cfg = {};
for (const n of ["balance", "objects", "biomes", "upgrades", "spinner", "goals"])
  cfg[n] = JSON.parse(fs.readFileSync("config/" + n + ".json", "utf8"));

const css = fs.readFileSync("style.css", "utf8");
const js = fs.readFileSync("game.js", "utf8");
if (js.includes("</script")) throw new Error("game.js contains '</script' — would break inlining");

const dev = fs.readFileSync("dev.html", "utf8");
const body = (dev.match(/<body[^>]*>([\s\S]*?)<\/body>/) || [])[1];
if (!body) throw new Error("could not extract <body> from dev.html");

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>ROCKFALL — endless boulder run</title>
<style>
${css}
</style>
<script src="https://cdn.babylonjs.com/babylon.js"><\/script>
<script src="net-config.js" defer onerror="this.remove()"><\/script>
<script src="net.js" defer onerror="this.remove()"><\/script>
</head>
<body>
${body.trim()}
<script>
window.__INLINE_CONFIG__ = ${JSON.stringify(cfg)};
<\/script>
<script>
${js}
<\/script>
</body>
</html>
`;

fs.writeFileSync("index.html", page);
fs.writeFileSync("standalone.html", page);
fs.writeFileSync("config.fallback.js",
  "/* Auto-generated bundled copy of config/*.json — used by dev.html when fetch fails (file://). */\n" +
  "window.__FALLBACK_CONFIG__ = " + JSON.stringify(cfg) + ";\n");

console.log("built: index.html (" + page.length + " B), standalone.html, config.fallback.js");
