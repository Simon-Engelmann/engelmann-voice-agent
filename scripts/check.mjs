// Lightweight lint/typecheck for this vanilla-JS project (no TS/bundler):
// syntax-checks every JS file (browser ES modules included) and validates JSON.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
let failures = 0;

function nodeCheck(file, asModule) {
  const args = asModule ? ['--experimental-default-type=module', '--check', file] : ['--check', file];
  try {
    execFileSync(process.execPath, args, { stdio: 'pipe' });
    console.log('ok   ', path.relative(root, file));
  } catch (e) {
    failures++;
    console.error('FAIL ', path.relative(root, file), '\n', String(e.stderr || e.message).slice(0, 600));
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);

// Server-side (CommonJS .js / ESM .mjs): let Node infer from extension/package.
for (const f of files) {
  if (f.includes(`${path.sep}public${path.sep}`)) continue;
  if (f.endsWith('.js') || f.endsWith('.mjs')) nodeCheck(f, f.endsWith('.mjs'));
}
// Browser modules under public/js use ES module syntax in .js files.
for (const f of files) {
  if (!f.includes(`${path.sep}public${path.sep}`)) continue;
  if (f.endsWith('.js')) nodeCheck(f, true);
}

// JSON validity.
for (const f of files) {
  if (!f.endsWith('.json') && !f.endsWith('.webmanifest')) continue;
  try { JSON.parse(readFileSync(f, 'utf8')); console.log('ok   ', path.relative(root, f)); }
  catch (e) { failures++; console.error('FAIL ', path.relative(root, f), e.message); }
}

if (failures) { console.error(`\n${failures} file(s) failed checks.`); process.exit(1); }
console.log('\nAll checks passed.');
