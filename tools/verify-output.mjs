// The gate, run locally: the seven rows the scorer checks, on a directory main.ts wrote, plus the
// dossier's text and the idempotence the gate's two runs need. Node 22, standard library only.
//
//   node tools/verify-output.mjs --out out --input ../token-radar-01-kit/input/snapshot.json
//
// It is not the scorer. It repeats the rules in RULES.txt so an entry is not handed in with a row that
// would have been trivially fixable, and it says which rule failed and where.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier, DOSSIER_MAX_BYTES } from '../vendor/makefun-board.ts';

const TEXT_MAX_BYTES = 65_536;
const DASHBOARD = { max_files: 400, max_bytes: 4 * 1024 * 1024 };
const SHOTS = { max: 4, max_bytes: 512 * 1024 };
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const rows = [];

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const out = arg('out', process.env.MAKEFUN_OUTPUT_DIR ?? 'out');
const input = arg('input', '/input');
const snapshotPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
const snapshot = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : null;
const slugs = new Set((snapshot?.protocols ?? []).map((p) => p.slug));

const pass = (row, detail) => rows.push({ row, ok: true, detail });
const fail = (row, detail) => rows.push({ row, ok: false, detail });

/** Every regular file under `root`, relative paths, dot-directories refused. */
function walk(root) {
  const found = [];
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const entry of readdirSync(rel === '' ? root : join(root, rel), { withFileTypes: true })) {
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) return { error: `${path} is a dot-directory` };
        stack.push(path);
      } else if (entry.isFile()) {
        found.push({ path, size: statSync(join(root, path)).size });
      } else return { error: `${path} is neither a file nor a directory` };
    }
  }
  return { files: found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

// ---------------------------------------------------------------- dashboard_files
const dashDir = join(out, 'dashboard');
let dashFiles = [];
if (!existsSync(dashDir)) {
  fail('dashboard_files', 'no dashboard/ directory');
} else {
  const walked = walk(dashDir);
  if (walked.error) fail('dashboard_files', walked.error);
  else {
    dashFiles = walked.files;
    const bytes = dashFiles.reduce((n, f) => n + f.size, 0);
    const badName = dashFiles.find((f) => !PLAIN.test(f.path.split('/').pop()));
    const hasCss = dashFiles.some((f) => f.path.endsWith('.css'));
    const hasJs = dashFiles.some((f) => f.path.endsWith('.js'));
    const hasIndex = dashFiles.some((f) => f.path === 'index.html');
    const problems = [];
    if (!hasIndex) problems.push('no index.html');
    if (!hasCss) problems.push('no .css file');
    if (!hasJs) problems.push('no .js file');
    if (dashFiles.length > DASHBOARD.max_files) problems.push(`${dashFiles.length} files, over ${DASHBOARD.max_files}`);
    if (bytes > DASHBOARD.max_bytes) problems.push(`${bytes} bytes, over ${DASHBOARD.max_bytes}`);
    if (badName) problems.push(`${badName.path}: a file's name is letters, digits and . _ -`);
    for (const file of dashFiles) {
      const text = readFileSync(join(dashDir, file.path), 'utf8');
      const ext = file.path.slice(file.path.lastIndexOf('.'));
      if (ext === '.html') {
        const tags = text.match(/<[a-zA-Z][^>]*>/g) ?? [];
        const attr = tags.find((t) => /=\s*["'][^"']*https?:\/\//i.test(t));
        if (attr) problems.push(`${file.path}: an attribute value names a network address (${attr.slice(0, 60)})`);
        const style = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(text);
        if (style && /https?:\/\//i.test(style[1])) problems.push(`${file.path}: an inline style body names a network address`);
        const inline = text.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
        const imp = inline.find((s) => /\bimport\b[\s\S]*?\bfrom\s*["'][^"']*https?:\/\//i.test(s));
        if (imp) problems.push(`${file.path}: an inline script imports a network address`);
      } else if (ext === '.css') {
        if (/https?:\/\//i.test(text)) problems.push(`${file.path}: a stylesheet names a network address`);
      } else if (ext === '.js' || ext === '.mjs') {
        const specs = [];
        for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\brequire\(\s*["']([^"']+)["']\s*\)/g, /\bimport\(\s*["']([^"']+)["']\s*\)/g, /^\s*import\s*["']([^"']+)["']/gm]) {
          for (const m of text.matchAll(re)) specs.push(m[1]);
        }
        const net = specs.find((s) => /https?:\/\//i.test(s));
        if (net) problems.push(`${file.path}: an import names a network address (${net})`);
      }
    }
    if (problems.length) fail('dashboard_files', problems.join('; '));
    else pass('dashboard_files', `${dashFiles.length} files, ${bytes} bytes, no network address in an attribute, style, import or stylesheet`);
  }
}

// ---------------------------------------------------------------- board_file, sorted_by_value, coverage, farm_steps
let board = null;
const boardPath = join(out, 'board.json');
if (!existsSync(boardPath)) {
  fail('board_file', 'no board.json');
} else {
  const bytes = statSync(boardPath).size;
  let doc = null;
  try {
    doc = JSON.parse(readFileSync(boardPath, 'utf8'));
  } catch {
    fail('board_file', 'board.json is not JSON');
  }
  if (doc !== null) {
    board = Array.isArray(doc) ? doc : Array.isArray(doc.rows) ? doc.rows : null;
    if (board === null) fail('board_file', 'board.json has no rows array');
    else if (board.length < 100 || board.length > 4000) fail('board_file', `${board.length} rows, outside 100 to 4000`);
    else if (bytes > 8 * 1024 * 1024) fail('board_file', `${bytes} bytes, over 8 MiB`);
    else {
      const problems = [];
      for (const [i, row] of board.entries()) {
        if (typeof row?.slug !== 'string' || !row.slug || /\s/.test(row.slug)) { problems.push(`row ${i}: bad slug`); break; }
        if (snapshot && !slugs.has(row.slug)) { problems.push(`row ${i}: ${row.slug} is not a snapshot protocol`); break; }
        if (typeof row.name !== 'string' || row.name.trim() === '') { problems.push(`row ${i}: no name`); break; }
        if (!Number.isInteger(row.rank) || row.rank < 1) { problems.push(`row ${i}: rank ${row.rank}`); break; }
        if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1 || row.implied_value_usd > 1e14) { problems.push(`row ${i}: implied value ${row.implied_value_usd}`); break; }
        if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) { problems.push(`row ${i}: ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 'no'} farm steps`); break; }
        const bad = row.farm_steps.map((s) => String(s).trim()).find((s) => s.length < 20 || s.length > 600);
        if (bad !== undefined) { problems.push(`row ${i}: a farm step of ${bad.length} characters`); break; }
      }
      if (problems.length) fail('board_file', problems.join('; '));
      else pass('board_file', `${board.length} rows, every slug a snapshot protocol, every plan 3 to 12 steps of 20 to 600 characters`);

      // sorted_by_value
      const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
      const ranksOk = ranks.every((r, i) => r === i + 1);
      const values = board.slice().sort((a, b) => a.rank - b.rank).map((r) => r.implied_value_usd);
      const monotone = values.every((v, i) => i === 0 || v <= values[i - 1]);
      const distinct = new Set(values).size > 1;
      if (!ranksOk) fail('sorted_by_value', `ranks are not 1..${board.length} once each`);
      else if (!monotone) fail('sorted_by_value', 'an implied value rises as rank ascends');
      else if (!distinct) fail('sorted_by_value', 'every row shares one implied value');
      else pass('sorted_by_value', `ranks 1..${board.length}, implied value never rises, ${new Set(values).size} distinct values`);

      // coverage
      if (snapshot === null) fail('coverage', 'no snapshot given: pass --input');
      else {
        const have = new Set(board.map((r) => r.slug));
        const missing = snapshot.watchlist.filter((s) => !have.has(s));
        if (missing.length) fail('coverage', `${missing.length} watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`);
        else pass('coverage', `all ${snapshot.watchlist.length} watchlist slugs are on the board`);
      }
    }
  }
}

// ---------------------------------------------------------------- screenshots
const shotDir = join(out, 'screenshots');
if (!existsSync(shotDir)) {
  fail('screenshots', 'no screenshots/ directory');
} else {
  const names = readdirSync(shotDir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
  const problems = [];
  if (names.length < 3 || names.length > SHOTS.max) problems.push(`${names.length} images, the gate wants 3 to 4`);
  for (const name of names) {
    if (!PLAIN.test(name)) { problems.push(`${name}: a name is letters, digits and . _ -`); continue; }
    const bytes = readFileSync(join(shotDir, name));
    if (bytes.length > SHOTS.max_bytes) { problems.push(`${name} is ${bytes.length} bytes, over 512 KiB`); continue; }
    const png = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) { problems.push(`${name} is neither a PNG nor a JPEG`); continue; }
    let width, height;
    if (png) { width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); }
    else {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) break;
        const marker = bytes[at + 1];
        const length = (bytes[at + 2] << 8) | bytes[at + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          height = (bytes[at + 5] << 8) | bytes[at + 6];
          width = (bytes[at + 7] << 8) | bytes[at + 8];
          break;
        }
        at += 2 + length;
      }
    }
    if (!width || !height) { problems.push(`${name}: the image's size cannot be read`); continue; }
    if (Math.max(width, height) > 1440) problems.push(`${name} is ${width}x${height}: long side over 1440`);
    if (Math.min(width, height) < 800) problems.push(`${name} is ${width}x${height}: short side under 800`);
  }
  if (problems.length) fail('screenshots', problems.join('; '));
  else pass('screenshots', `${names.length} whole images, ${names.map((n) => `${n} ${Math.round(statSync(join(shotDir, n)).size / 1024)} KB`).join(', ')}`);
}

// ---------------------------------------------------------------- dossier_matches
const dossierPath = join(out, 'dossier.json');
if (!existsSync(dossierPath)) {
  fail('dossier_matches', 'no dossier.json');
} else {
  try {
    const expected = buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES });
    const actual = readFileSync(dossierPath);
    if (Buffer.compare(Buffer.from(expected), actual) !== 0) fail('dossier_matches', `dossier.json is ${actual.length} bytes, not the ${expected.length} buildDossier writes`);
    else if (actual.length > DOSSIER_MAX_BYTES) fail('dossier_matches', `${actual.length} bytes, over 4 MiB`);
    else {
      const text = JSON.parse(actual.toString('utf8')).text;
      const cut = /\[Cut at \d+ bytes|lines not shown/.test(text);
      const textBytes = Buffer.byteLength(text, 'utf8');
      if (cut) fail('dossier_matches', `the dossier is byte-identical, but its text is cut at ${textBytes} bytes: the judge reads a partial source`);
      else pass('dossier_matches', `byte-identical to buildDossier, ${actual.length} bytes, source text ${textBytes} bytes and whole`);
    }
  } catch (err) {
    fail('dossier_matches', String(err && err.message ? err.message : err));
  }
}

// ---------------------------------------------------------------- report
const failed = rows.filter((r) => !r.ok);
for (const r of rows) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.row.padEnd(16)} ${r.detail}\n`);
process.stdout.write(`\n${rows.length - failed.length} of ${rows.length} rows pass${failed.length ? `: ${failed.map((r) => r.row).join(', ')} fail` : ''}\n`);
process.exit(failed.length ? 1 : 0);
