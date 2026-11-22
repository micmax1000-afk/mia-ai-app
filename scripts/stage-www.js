#!/usr/bin/env node
/** Copia solo i file web necessari in www/ per Capacitor. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const www = path.join(root, 'www');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name.startsWith('.')) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.rmSync(www, { recursive: true, force: true });
fs.mkdirSync(www, { recursive: true });

for (const f of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  const s = path.join(root, f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(www, f));
}
for (const dir of ['css', 'js', 'icons']) {
  const s = path.join(root, dir);
  if (fs.existsSync(s)) copyDir(s, path.join(www, dir));
}

console.log('www/ pronto per Capacitor');
