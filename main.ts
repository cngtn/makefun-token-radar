// Token Radar: the ranked board of pre-token protocols and the page that shows it.
//
// Node 22, standard library only, no network. One run reads the sealed snapshot, scores every protocol
// whose record carries no token with the model in lib/model.ts, and writes:
//
//   <out>/board.json            the ranked board, rows 1..N
//   <out>/data.js               the page's dataset as one classic script
//   <out>/dashboard/            this repository's dashboard/, plus a generated build manifest
//   <out>/screenshots/          this repository's screenshots/
//   <out>/dossier.json          what buildDossier writes from the two, byte for byte
//
// Two runs over the same snapshot write the same bytes: every array is sorted with an explicit
// comparator, nothing reads the clock, the host or the filesystem's ordering, and the file lists are
// written out rather than discovered.
//
// Locally, MAKEFUN_OUTPUT_DIR stands in for the grader's /output:
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, previewManifest } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The gate's caps, as the scorer states them. The text cap shapes the dossier's bytes. */
const TEXT_MAX_BYTES = 65_536;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4 * 1024 * 1024 };
const SCREENSHOT_CAPS = { max: 4, max_bytes: 350 * 1024 };
const MAX_DASHBOARD_SOURCE = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The dashboard, file by file, so a copy never depends on the order a directory lists in. */
const DASHBOARD_FILES = ['index.html', 'app.css', 'app.js', 'model.md'] as const;

/** The three screenshots, by name, so the cover is the board. */
const SCREENSHOTS = ['1-board.png', '2-detail.png', '3-filtered.png'] as const;

/** A `--flag value` or `--flag=value` argument, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The pixel size of a whole PNG or JPEG, or null: the gate holds every screenshot to a shape. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; kind: 'png' | 'jpeg' } | null {
  const opens = (magic: readonly number[]): boolean => bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);
  if (opens([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    if (bytes.length < 24) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20), kind: 'png' };
  }
  if (opens([0xff, 0xd8, 0xff])) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1]!;
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: (bytes[at + 7]! << 8) | bytes[at + 8]!, height: (bytes[at + 5]! << 8) | bytes[at + 6]!, kind: 'jpeg' };
      }
      at += 2 + length;
    }
    return null;
  }
  return null;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// ------------------------------------------------------------------ the board and the page's data
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// ------------------------------------------------------------------ the dashboard
function copyDashboard(): number {
  const from = join(here, 'dashboard');
  const to = join(out, 'dashboard');
  mkdirSync(to, { recursive: true });
  let bytes = 0;
  for (const name of DASHBOARD_FILES) {
    const path = join(from, name);
    if (!existsSync(path)) fail(`dashboard/${name} is missing from the repository`);
    copyFileSync(path, join(to, name));
    bytes += statSync(path).size;
  }
  // The one generated file: the model's constants, the market's peer figures and the top of the board,
  // so the dossier's source text shows real numbers beside the formula that produced them.
  const preview = previewManifest(radar);
  writeFileSync(join(to, 'board-preview.json'), preview);
  bytes += Buffer.byteLength(preview, 'utf8');
  if (bytes > MAX_DASHBOARD_SOURCE) {
    process.stderr.write(`token radar: warning: dashboard source is ${bytes} bytes, over the ${MAX_DASHBOARD_SOURCE} the dossier shows whole\n`);
  }
  if (bytes > DASHBOARD_CAPS.max_bytes) fail(`dashboard source is ${bytes} bytes, over the gate's ${DASHBOARD_CAPS.max_bytes}`);
  return bytes;
}

const dashboardBytes = copyDashboard();

// ------------------------------------------------------------------ the screenshots
function copyScreenshots(): number {
  const from = join(here, 'screenshots');
  const to = join(out, 'screenshots');
  mkdirSync(to, { recursive: true });
  let copied = 0;
  let total = 0;
  for (const name of SCREENSHOTS) {
    const path = join(from, name);
    if (!existsSync(path)) fail(`screenshots/${name} is missing: the entry hands in the board, a detail view and a filtered view`);
    if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    const size = statSync(path).size;
    // The gate's own caps: a whole PNG or JPEG of at most 512 KiB, long side at most 1440, short side
    // at least 800. The images are lossless PNG, so a bigger file would buy no more detail.
    if (size > 512 * 1024) fail(`screenshots/${name} is ${size} bytes, over the 512 KiB a screenshot may hold`);
    const shape = imageSize(readFileSync(path));
    if (shape === null) fail(`screenshots/${name} is neither a whole PNG nor a whole JPEG`);
    const longSide = Math.max(shape.width, shape.height);
    const shortSide = Math.min(shape.width, shape.height);
    if (longSide > 1440 || shortSide < 800) fail(`screenshots/${name} is ${shape.width}x${shape.height}: the gate wants a long side at most 1440 and a short side at least 800`);
    copyFileSync(path, join(to, name));
    copied += 1;
    total += size;
  }
  if (copied !== 3) fail(`screenshots/ holds ${copied} images: the entry hands in exactly three`);
  // The dossier holds the images base64-encoded beside a 64 KiB text and may not pass 1.5 MiB, so the
  // three images together must stay near 1 MiB.
  if (total > 1_050_000) {
    fail(`screenshots/ comes to ${total} bytes: base64 in the dossier plus the text would pass its 1.5 MiB cap`);
  }
  return copied;
}

const shotCount = copyScreenshots();

// ------------------------------------------------------------------ the dossier
// Written last: the gate rebuilds it from this directory and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
);

const top = board[0]!;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.meta.pre_token} record no token, ` +
    `${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.meta.below_floor} below the floor)\n` +
    `token radar: the market's own peer multiple is ${radar.model.global.median.toFixed(3)}x on ${radar.model.global.peers} priced tokens; ` +
    `rank 1 is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${DASHBOARD_FILES.length + 1} files, ${dashboardBytes} bytes), ` +
    `screenshots/ (${shotCount} images) and dossier.json to ${out}\n`,
);
