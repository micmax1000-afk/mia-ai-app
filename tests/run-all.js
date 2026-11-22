#!/usr/bin/env node
/*
 * Esegue i test di tests/e2e/ uno dopo l'altro e controlla per ognuno:
 *  - codice di uscita 0 e nessuna riga «FAIL»;
 *  - nessun TypeError / ReferenceError / SyntaxError nell'output;
 *  - tutte le righe attese di expectations.js.
 * Uso:  node run-all.js [filtro ...] [--list] [--verbose]
 */
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const expectations = require('./expectations.js');

const root = path.resolve(__dirname, '..');
const dir = path.join(__dirname, 'e2e');
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const filters = args.filter((a) => !a.startsWith('--'));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().filter((f) => !filters.length || filters.some((x) => f.includes(x)));

if (args.includes('--list')) {
  files.forEach((f) => console.log(f));
  process.exit(0);
}

// le prove della versione web servono la cartella www/ costruita dal progetto
console.log('Preparo www/ …');
execFileSync('node', [path.join(root, 'scripts', 'stage-www.js')], { cwd: root, stdio: 'ignore' });

const FORBID = [/^FAIL/m, /\b(TypeError|ReferenceError|SyntaxError)\b/];
let failed = 0;
let skipped = 0;
const t0 = Date.now();

for (const f of files) {
  const t = Date.now();
  const r = spawnSync('node', [path.join(dir, f)], { cwd: __dirname, encoding: 'utf8', timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  const problems = [];
  if (/^SKIP:/m.test(out)) {
    skipped++;
    console.log('– ' + f + '  (saltato: ' + (out.match(/^SKIP: (.*)$/m) || [])[1] + ')');
    continue;
  }
  if (r.error && r.error.code === 'ETIMEDOUT') problems.push('tempo scaduto (240 s)');
  else if (r.status !== 0) problems.push('codice di uscita ' + r.status);
  FORBID.forEach((re) => re.test(out) && problems.push('compare ' + re));
  const exp = expectations[f];
  if (!exp) problems.push('nessuna riga attesa definita in expectations.js');
  else exp.forEach((re) => !re.test(out) && problems.push('manca: ' + re));
  const sec = ((Date.now() - t) / 1000).toFixed(1) + ' s';
  if (problems.length) {
    failed++;
    console.log('✗ ' + f + '  (' + sec + ')');
    problems.forEach((p) => console.log('    ' + p));
    console.log('    --- ultime righe dell\'output ---\n' + out.trim().split('\n').slice(-12).map((l) => '    ' + l.slice(0, 160)).join('\n'));
  } else {
    console.log('✓ ' + f + '  (' + sec + ', ' + (exp ? exp.length : 0) + ' controlli)');
    if (verbose) console.log(out);
  }
}

console.log('\n' + (files.length - failed - skipped) + ' riusciti, ' + failed + ' falliti' + (skipped ? ', ' + skipped + ' saltati' : '') + ' — ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
process.exit(failed ? 1 : 0);
