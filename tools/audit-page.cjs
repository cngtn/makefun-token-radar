// Numeric layout audit of the page: every assertion the design claims, page by page, one table row each.
// Development tool, not part of the entry: it needs Playwright, which the program never does.
//
//   node tools/audit-page.cjs <repository> [board detail filtered method live]

const { chromium } = require('playwright');
const path = require('node:path');

const repo = process.argv[2];
const pages = process.argv.slice(3);
const targets = pages.length ? pages : ['board', 'detail', 'filtered', 'method', 'live'];
const file = 'file:///' + path.join(repo, 'out', 'dashboard', 'index.html').replace(/\\/g, '/');
const hash = { board: '', detail: '#/p/onre', filtered: '#/cat/CDP', method: '#/tab/method', live: '#/tab/live' };

const rows = [];
function add(page, name, ok, count, detail) {
  rows.push({ page, name, ok: ok ? 'PASS' : 'FAIL', count, detail: detail || '' });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on('pageerror', (e) => errors.push(String(e)));
  tab.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  for (const page of targets) {
    await tab.goto(file + (hash[page] || ''));
    await tab.waitForTimeout(350);
    const r = await tab.evaluate(() => {
      const els = [...document.querySelectorAll('body *')].filter((el) => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE';
      });
      const box = (el) => el.getBoundingClientRect();
      const textish = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      const interactive = (el) => ['A', 'BUTTON', 'INPUT', 'SELECT'].includes(el.tagName) || el.getAttribute('role') === 'button' || el.hasAttribute('tabindex');

      // horizontal overflow of the document and of any element past the viewport
      const wide = els.filter((el) => box(el).right > window.innerWidth + 1 || box(el).left < -1).map((el) => el.tagName + '.' + String(el.className).slice(0, 24));

      // text clipped by its own container
      const clipped = els.filter((el) => {
        const s = getComputedStyle(el);
        if (s.overflowX === 'visible' && s.overflowY === 'visible') return false;
        return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      }).filter((el) => textish(el)).map((el) => el.tagName + '.' + String(el.className).slice(0, 24) + ' ' + el.scrollWidth + '>' + el.clientWidth);

      // overlaps between elements that are not ancestors, ignore taps and the fixed drawer over the board
      const blocks = els.filter((el) => (textish(el) || interactive(el)) && box(el).width > 4 && box(el).height > 4);
      const overlaps = [];
      for (let i = 0; i < blocks.length; i += 1) {
        const a = blocks[i];
        if (a.closest('#drawer') || a.closest('.scrim')) continue;
        for (let j = i + 1; j < blocks.length; j += 1) {
          const b = blocks[j];
          if (b.closest('#drawer')) continue;
          if (a.contains(b) || b.contains(a)) continue;
          const ra = box(a);
          const rb = box(b);
          const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
          if (w > 2 && h > 2) {
            const sa = getComputedStyle(a).position;
            const sb = getComputedStyle(b).position;
            if (sa === 'fixed' || sb === 'fixed') continue;
            overlaps.push(a.tagName + '.' + String(a.className).slice(0, 18) + ' × ' + b.tagName + '.' + String(b.className).slice(0, 18));
            if (overlaps.length > 4) i = blocks.length;
          }
        }
      }

      // table cells aligned: every cell's vertical centre within 3px of its row's
      const misaligned = [];
      for (const row of document.querySelectorAll('.row')) {
        const cells = [...row.children].map((c) => box(c));
        if (!cells.length) continue;
        const mid = (cells[0].top + cells[0].bottom) / 2;
        const off = Math.max(...cells.map((c) => Math.abs((c.top + c.bottom) / 2 - mid)));
        if (off > 3) misaligned.push(Math.round(off));
      }

      // spacing grid: margins and paddings multiples of 4
      const offGrid = [];
      const offGridKeys = new Map();
      for (const el of els) {
        const s = getComputedStyle(el);
        for (const k of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']) {
          const v = parseFloat(s[k]);
          if (isFinite(v) && v !== 0 && Number.isInteger(v) && v % 4 !== 0) {
            offGrid.push(el.tagName + '.' + String(el.className).slice(0, 18) + ' ' + k + '=' + v);
            const key = el.tagName + '.' + String(el.className).slice(0, 18) + ' ' + k + '=' + v;
            offGridKeys.set(key, (offGridKeys.get(key) || 0) + 1);
          }
        }
      }

      // one type scale for text
      const sizes = new Map();
      for (const el of els) {
        if (!textish(el)) continue;
        const f = getComputedStyle(el).fontSize;
        sizes.set(f, (sizes.get(f) || 0) + 1);
      }
      const scale = [...sizes.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

      // contrast, compositing translucent backgrounds up the tree
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return { r: 0, g: 0, b: 0, a: 0 };
        const p = m[1].split(',').map((x) => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
      const lum = (c) => {
        const f = (v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const bgOf = (el) => {
        let bg = { r: 9, g: 13, b: 18, a: 1 };
        const chain = [];
        for (let n = el; n; n = n.parentElement) chain.unshift(n);
        for (const n of chain) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c.a > 0) bg = over(c, bg);
        }
        return bg;
      };
      const ratios = [];
      for (const el of els) {
        if (!textish(el)) continue;
        const fg = parse(getComputedStyle(el).color);
        const bg = bgOf(el);
        const L1 = lum(over(fg, bg));
        const L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(getComputedStyle(el).fontSize);
        const bold = parseInt(getComputedStyle(el).fontWeight, 10) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        if (ratio < (large ? 3 : 4.5)) ratios.push(el.tagName + '.' + String(el.className).slice(0, 20) + ' ' + ratio.toFixed(2) + (large ? ' (large)' : ''));
      }

      // the fold: rows fully above 900, the gap under the last one, and anything important below
      const visible = [...document.querySelectorAll('.row')].filter((el) => box(el).bottom <= 900);
      const next = [...document.querySelectorAll('.row')].find((el) => box(el).top >= 900 || box(el).bottom > 900);
      const important = [...document.querySelectorAll('.masthead, .formula, .tabs, .controls, .status, .integrity, .thead')].map((el) => [el.className, Math.round(box(el).bottom)]);
      const below = [...document.querySelectorAll('#drawer h3, #drawer .plan li, #drawer .peers')].filter((el) => box(el).bottom > 900).map((el) => el.className + '@' + Math.round(box(el).bottom));

      return {
        wide: wide.slice(0, 6),
        wideCount: wide.length,
        clipped,
        clippedCount: clipped.length,
        overlaps: overlaps.slice(0, 5),
        overlapCount: overlaps.length,
        misaligned,
        offGridCount: offGrid.length,
        offGrid: [...offGridKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0] + ' x' + e[1]),
        scale,
        ratios,
        ratioCount: ratios.length,
        rows: visible.length,
        gap: next ? Math.round(900 - box(visible[visible.length - 1]).bottom) : null,
        nextTop: next ? Math.round(box(next).top) : null,
        important,
        below: below.slice(0, 6),
        belowCount: below.length,
        scrollWidth: document.documentElement.scrollWidth,
        drawerOpen: !document.getElementById('drawer').hidden
      };
    });

    add(page, 'no horizontal overflow', r.wideCount === 0 && r.scrollWidth <= 1440, r.wideCount, r.wide.slice(0, 3).join(' | '));
    add(page, 'no clipped text', r.clippedCount === 0, r.clippedCount, r.clipped.slice(0, 3).join(' | '));
    add(page, 'no overlapping blocks', r.overlapCount === 0, r.overlapCount, r.overlaps.slice(0, 3).join(' | '));
    add(page, 'row cells centred', r.misaligned.length === 0, r.misaligned.length, r.misaligned.slice(0, 4).join(','));
    add(page, 'spacing on the 4px grid', r.offGridCount === 0, r.offGridCount, r.offGrid.slice(0, 4).join(' | '));
    const SCALE = [10, 12, 14, 17, 20, 24, 29, 35];
    const offScale = r.scale.filter((s) => !SCALE.includes(parseFloat(s[0])));
    add(page, 'one type scale', offScale.length === 0, r.scale.length, r.scale.map((s) => s[0] + '×' + s[1]).join(' '));
    add(page, 'contrast AA', r.ratioCount === 0, r.ratioCount, r.ratios.slice(0, 4).join(' | '));
    const tablePage = page === 'board' || page === 'detail' || page === 'filtered';
    const foldOk = !tablePage || r.gap === null || (r.gap >= 0 && r.gap <= 8);
    add(page, 'fold on a row edge', foldOk, r.rows, 'rows=' + r.rows + ' gap=' + r.gap + ' next=' + r.nextTop);
    if (page === 'board' || page === 'detail') add(page, 'nothing important below 900', r.belowCount === 0, r.belowCount, r.below.slice(0, 3).join(' | '));
    rows.rows = rows.rows || [];
    rows[rows.length - 1].important = r.important;
    rows[rows.length - 1].scale = r.scale;
  }

  const table = rows.filter((r) => r.name);
  const w = (s, n) => String(s).padEnd(n);
  console.log(w('page', 9) + w('assertion', 30) + w('result', 7) + w('count', 7) + 'detail');
  for (const r of table) console.log(w(r.page, 9) + w(r.name, 30) + w(r.ok, 7) + w(r.count, 7) + String(r.detail).slice(0, 90));
  const fails = table.filter((r) => r.ok === 'FAIL');
  console.log('\n' + (table.length - fails.length) + ' of ' + table.length + ' assertions pass');
  const cues = table.filter((r) => r.important);
  for (const c of cues) console.log('fold: ' + c.page + ' header blocks ' + JSON.stringify(c.important));
  if (errors.length) console.log('page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
