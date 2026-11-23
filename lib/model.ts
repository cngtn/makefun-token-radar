// The radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// The formula, in one line: implied = TVL x peer multiple x momentum x tenure. Every factor comes from
// the snapshot's own figures -- see DESIGN.md for the reasoning. The reference multiple is read off the
// snapshot's 128 token-bearing protocols that carry a market cap; no protocol name is ever special-cased,
// and a protocol whose token already trades is never scored by this model (it is shown at its market cap).
//
// The board covers every slug in the watchlist, then the pre-token protocols below the watchlist floor
// with the most TVL: the early rows the radar exists to find.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: which of them are read off the data is said beside each. */
export interface ModelConstants {
  version: string;
  /** Peers in a category that weigh as much as the market-wide prior (peer shrink k). */
  peer_shrink: number;
  /** Ratios outside this band are dropped: the snapshot holds one 400x outlier. */
  ratio_min: number;
  ratio_max: number;
  /** No category's multiple may stray this factor from the market-wide one. */
  peer_band_global: number;
  /** Momentum: weight of the seven-day change, its clip, and the factor's own bounds. */
  growth_weight: number;
  growth_clip_low: number;
  growth_clip_high: number;
  momentum_low: number;
  momentum_high: number;
  /** Tenure: the ramp's ends and length, and the value of an unknown age. */
  tenure_low: number;
  tenure_high: number;
  tenure_days: number;
  tenure_unknown: number;
}

export const MODEL: ModelConstants = {
  version: 'peer-1',
  peer_shrink: 5,
  ratio_min: 0.01,
  ratio_max: 40,
  peer_band_global: 2.8,
  growth_weight: 0.45,
  growth_clip_low: -60,
  growth_clip_high: 150,
  momentum_low: 0.55,
  momentum_high: 1.85,
  tenure_low: 0.62,
  tenure_high: 1.34,
  tenure_days: 1460,
  tenure_unknown: 0.98,
};

/** How many pre-token protocols below the floor the early radar adds, by TVL. */
export const EARLY_ROWS = 200;

/** How many token-bearing protocols the "already trades" view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A market-cap multiple of TVL: the market's own reading of what $1 of TVL is worth in a token. */
export interface PeerStat {
  peers: number;
  /** Unshrunk median of ln(ratio), and the shrunk median the model prices with. */
  median: number;
  p25: number;
  p75: number;
}

/** One token-bearing protocol, as the evidence table beside a board row shows it. */
export interface PeerSample {
  name: string;
  mult: number;
  mcap_usd: number;
  tvl_usd: number;
}

/** One row of board.json. Extra keys are the model's own working, kept so the page can show it. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'below-floor';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  factors: {
    peer_multiple: number;
    peer_peers: number;
    peer_median: number;
    peer_p25: number;
    peer_p75: number;
    growth_pct: number | null;
    momentum: number;
    tenure: number;
  };
  farm_steps: string[];
  peer_sample: PeerSample[];
}

/** A live-token protocol: its token trades, so its value is the market's, not the model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** A category's peer evidence, for the method page. */
export interface CategoryStat {
  name: string;
  peers: number;
  median: number;
  p25: number;
  p75: number;
  shrunk: number;
}

/** Everything the page renders, from the snapshot and the model that scored it. */
export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: number;
    pre_token: number;
    token_bearing: number;
    with_mcap: number;
    watchlist: number;
    board_size: number;
    below_floor: number;
    tvl_in_scope: number;
  };
  model: ModelConstants & {
    global: { peers: number; median: number; p25: number; p75: number };
  };
  categories: CategoryStat[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const bySlugOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const median = (sorted: number[]): number => {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
const percentile = (sorted: number[], f: number): number => {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * f)));
  return sorted[at]!;
};
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const round = (n: number, places: number): number => {
  const p = 10 ** places;
  return Math.round(n * p) / p;
};

/** Whole days between the snapshot's day and the day DefiLlama began tracking the protocol. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol's record carries no token at all: no market cap, no CoinGecko id, no ticker. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The snapshot's own reading of what a token is worth per dollar of TVL, over every token it prices. */
interface PeerTable {
  global: PeerStat;
  byCategory: Map<string, PeerStat>;
  samples: Map<string, PeerSample[]>;
  allSamples: PeerSample[];
}

/** ln of a protocol's market-cap-to-TVL ratio, clamped, or null when it holds no usable market cap. */
function logRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.log(clamp(p.mcap_usd / p.tvl_usd, model.ratio_min, model.ratio_max));
}

/** A category's peers: the log-medians, shrunk toward the market's own and clamped into the peer band. */
function peerStat(name: string, samples: PeerSample[], global: { median: number; p25: number; p75: number }, model: ModelConstants): PeerStat {
  const logs = samples.map((s) => Math.log(clamp(s.mult, model.ratio_min, model.ratio_max))).sort((a, b) => a - b);
  const n = logs.length;
  const shrink = (own: number, market: number): number => {
    if (n === 0) return market;
    const blended = (n * own + model.peer_shrink * market) / (n + model.peer_shrink);
    const span = Math.log(model.peer_band_global);
    // Both figures are logarithms of a multiple, so the band is taken around the market's own log.
    return clamp(blended, market - span, market + span);
  };
  const own = { median: median(logs), p25: percentile(logs, 0.25), p75: percentile(logs, 0.75) };
  const marketLog = { median: Math.log(global.median), p25: Math.log(global.p25), p75: Math.log(global.p75) };
  return {
    peers: n,
    median: Math.exp(shrink(own.median, marketLog.median)),
    p25: Math.exp(shrink(own.p25, marketLog.p25)),
    p75: Math.exp(shrink(own.p75, marketLog.p75)),
  };
}

/** The peer table: every token-bearing protocol's multiple, grouped by category, with a sample each. */
function peerTable(protocols: SnapshotProtocol[], model: ModelConstants): PeerTable {
  const all: PeerSample[] = [];
  const groups = new Map<string, PeerSample[]>();
  for (const p of protocols) {
    if (logRatio(p, model) === null) continue;
    const sample: PeerSample = { name: p.name, mult: p.mcap_usd! / p.tvl_usd, mcap_usd: p.mcap_usd!, tvl_usd: p.tvl_usd };
    all.push(sample);
    const key = categoryKey(p.category);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [sample]);
    else bucket.push(sample);
  }
  const logs = all.map((s) => Math.log(clamp(s.mult, model.ratio_min, model.ratio_max))).sort((a, b) => a - b);
  const global = { median: Math.exp(median(logs)), p25: Math.exp(percentile(logs, 0.25)), p75: Math.exp(percentile(logs, 0.75)) };
  const byCategory = new Map<string, PeerStat>();
  for (const [key, samples] of groups) byCategory.set(key, peerStat(key, samples, global, model));
  return { global: { peers: all.length, median: global.median, p25: global.p25, p75: global.p75 }, byCategory, samples: groups, allSamples: all };
}

/** A category's grouping key: DefiLlama's own name, or a stand-in when it names none. */
function categoryKey(category: string | null): string {
  return category === null || category.trim() === '' ? 'Uncategorised' : category;
}

/** The three factors and the value they imply for one pre-token protocol. */
export interface Score {
  implied: number;
  low: number;
  high: number;
  peer: PeerStat;
  growthPct: number | null;
  momentum: number;
  tenure: number;
  age: number | null;
}

/**
 * The score one protocol gets under the model: TVL x peer multiple x momentum x tenure.
 *
 * The factors are rounded to six places before the product is taken, and the page recomputes the
 * product from the same rounded factors in the same order, so the number on the screen is the number
 * in board.json bit for bit rather than to within a tolerance.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants, peers: PeerTable): Score {
  const age = ageDays(asOf, p.listed_at);
  const stat = peers.byCategory.get(categoryKey(p.category)) ?? {
    peers: 0,
    median: peers.global.median,
    p25: peers.global.p25,
    p75: peers.global.p75,
  };
  const rawGrowth = p.change_7d;
  const clipped = rawGrowth === null ? 0 : clamp(rawGrowth, model.growth_clip_low, model.growth_clip_high);
  const momentum = clamp(1 + (clipped / 100) * model.growth_weight, model.momentum_low, model.momentum_high);
  const tenure = age === null ? model.tenure_unknown : model.tenure_low + ((model.tenure_high - model.tenure_low) * Math.min(age, model.tenure_days)) / model.tenure_days;
  const peerMultiple = round(stat.median, 6);
  const peerLow = round(stat.p25, 6);
  const peerHigh = round(stat.p75, 6);
  const momentumFactor = round(momentum, 6);
  const tenureFactor = round(tenure, 6);
  const value = (multiple: number): number => Math.max(1, Math.round(p.tvl_usd * multiple * momentumFactor * tenureFactor));
  return {
    implied: value(peerMultiple),
    low: value(peerLow),
    high: value(peerHigh),
    peer: { peers: stat.peers, median: peerMultiple, p25: peerLow, p75: peerHigh },
    growthPct: rawGrowth,
    momentum: momentumFactor,
    tenure: tenureFactor,
    age,
  };
}

/** The token-bearing protocols of a category, closest multiple first, for a row's evidence table. */
function peerEvidence(peers: PeerTable, category: string | null, target: number, limit: number): PeerSample[] {
  const own = peers.samples.get(categoryKey(category)) ?? [];
  const pool = own.length > 0 ? own : peers.allSamples;
  const distance = (s: PeerSample): number => Math.abs(Math.log(clamp(s.mult, 0.01, 40)) - Math.log(target));
  return pool
    .slice()
    .sort((a, b) => distance(a) - distance(b) || a.mult - b.mult || bySlugOrder(a.name, b.name))
    .slice(0, limit)
    .map((s) => ({ name: s.name, mult: round(s.mult, 4), mcap_usd: s.mcap_usd, tvl_usd: s.tvl_usd }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot.protocols, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  const tier = new Map<string, 'watchlist' | 'below-floor'>();
  // The watchlist is the floor, never the ceiling: every slug on it is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p === undefined) continue;
    chosen.set(slug, p);
    tier.set(slug, 'watchlist');
  }
  // The early radar: pre-token protocols under the floor, by TVL. Never less than enough to clear the
  // gate's 100-row minimum, and never so many that the page cannot show a useful board.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && recordsNoToken(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugOrder(a.slug, b.slug))
    .slice(0, EARLY_ROWS);
  for (const p of early) {
    chosen.set(p.slug, p);
    tier.set(p.slug, 'below-floor');
  }

  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, model, peers) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || bySlugOrder(a.p.slug, b.p.slug));
  return scored.map(({ p, score }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: null,
    listed_at: p.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: 'pre-token',
    tier: tier.get(p.slug) ?? 'below-floor',
    age_days: score.age,
    implied_value_usd: score.implied,
    implied_low_usd: score.low,
    implied_high_usd: score.high,
    factors: {
      peer_multiple: round(score.peer.median, 6),
      peer_peers: score.peer.peers,
      peer_median: round(score.peer.median, 6),
      peer_p25: round(score.peer.p25, 6),
      peer_p75: round(score.peer.p75, 6),
      growth_pct: score.growthPct === null ? null : round(score.growthPct, 4),
      momentum: round(score.momentum, 6),
      tenure: round(score.tenure, 6),
    },
    farm_steps: farmPlan(p, score.age, score.peer),
    peer_sample: peerEvidence(peers, p.category, score.peer.median, 3),
  }));
}

/** The token-bearing protocols the page shows beside the board, at the market's own value. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || bySlugOrder(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.tvl_usd > 0 ? round(p.mcap_usd! / p.tvl_usd, 4) : null,
    }));
}

/** The categories with the most peers, for the method page's evidence table. */
function categoryStats(peers: PeerTable): CategoryStat[] {
  return [...peers.byCategory.entries()]
    .map(([name, stat]) => ({ name, peers: stat.peers, median: round(stat.median, 4), p25: round(stat.p25, 4), p75: round(stat.p75, 4), shrunk: round(stat.median, 4) }))
    .sort((a, b) => b.peers - a.peers || bySlugOrder(a.name, b.name));
}

/** Everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const peers = peerTable(snapshot.protocols, model);
  const preToken = snapshot.protocols.filter(recordsNoToken).length;
  const tokenBearing = snapshot.protocols.length - preToken;
  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols: snapshot.protocols.length,
      pre_token: preToken,
      token_bearing: tokenBearing,
      with_mcap: peers.global.peers,
      watchlist: snapshot.watchlist.length,
      board_size: board.length,
      below_floor: board.filter((r) => r.tier === 'below-floor').length,
      tvl_in_scope: board.reduce((n, r) => n + r.tvl_usd, 0),
    },
    model: { ...model, global: peers.global },
    categories: categoryStats(peers),
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** A whole-dollars figure for a sentence: grouped by thousands, never by the host's locale. */
function dollars(n: number): string {
  const whole = String(Math.round(n));
  let out = '';
  for (let i = 0; i < whole.length; i++) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += ',';
    out += whole[i];
  }
  return `$${out}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 250_000_000) return 120;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  return 50;
}

/** The gas one action costs on a chain of this protocol's size: a round number, stated as an estimate. */
function gasFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 8;
  if (tvl >= 100_000_000) return 5;
  return 3;
}

/** How long to hold, from the protocol's age: a young protocol needs more than one snapshot to count. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 400) return 45;
  return 30;
}

/** The weekly cadence's length: a season, longer for a protocol with no season yet. */
function weeksFor(age: number | null): number {
  return age === null || age < 240 ? 12 : 8;
}

/** The category's one entry action, in the words a farmer can follow, with its cost and its time. */
export function entryAction(name: string, category: string | null, chain: string, capital: number, gas: number): string {
  const c = (category ?? '').toLowerCase();
  const base = `Deposit ${dollars(capital)} of USDC into ${name} on ${chain} through its own app and keep the position open.`;
  const tail = ` Cost: ${dollars(capital)} of capital plus about ${dollars(gas)} of gas. Time: 25 minutes.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${dollars(capital)} of USDC to ${name} on ${chain} and borrow a stablecoin against at most half of it.${tail}`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide ${dollars(capital)} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP tokens in the depositing wallet.${tail}`;
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) return `Deposit ${dollars(capital)} into one ${name} vault on ${chain} and keep the vault shares in the depositing wallet.${tail}`;
  if (c.includes('rwa')) return `Buy or mint ${dollars(capital)} of ${name}'s yield asset on ${chain} and hold it in the wallet that bought it.${tail}`;
  if (c.includes('basis')) return `Fund ${dollars(capital)} with ${name} on ${chain} and run one small delta-neutral or basis position to qualify.${tail}`;
  if (c.includes('restak')) return `Restake ${dollars(capital)} of ${chain}'s staking asset through ${name} and keep the receipt token.${tail}`;
  if (c.includes('staking') || c.includes('governance')) return `Stake ${dollars(capital)} of ${chain}'s staking asset with ${name} and vote on at least one open proposal.${tail}`;
  if (c.includes('chain')) return `Bridge ${dollars(capital)} of USDC onto ${name} through its own bridge and deposit the funds in an app on that chain.${tail}`;
  if (c.includes('insurance')) return `Buy ${dollars(capital)} of cover from ${name} on ${chain} and keep the policy for its full term.${tail}`;
  if (c.includes('payment')) return `Send ${dollars(capital)} through ${name} on ${chain} in a few separate payments and keep every receipt.${tail}`;
  if (c.includes('stable')) return `Mint the stable asset ${name} issues against ${dollars(capital)} of collateral on ${chain} and hold it.${tail}`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return `Deposit ${dollars(capital)} of USDC as margin on ${name} and open one small hedge to qualify.${tail}`;
  if (c.includes('predict')) return `Fund ${dollars(capital)} on ${name} and take one position in a market you understand.${tail}`;
  if (c.includes('bridge')) return `Bridge ${dollars(capital)} of USDC to ${chain} through ${name} and use the funds in its app.${tail}`;
  return `${base}${tail}`;
}

/**
 * A protocol's farm plan: eight steps, each with its action, its cost and its time, derived from the
 * protocol's own record -- category, first chain, TVL tier, age -- so no two protocols get the same
 * sentences from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, peer: PeerStat): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p.tvl_usd);
  const gas = gasFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const weeks = weeksFor(age);
  const thin = peer.peers < 5;
  return [
    `Open a wallet on ${chain} that holds only farm money and fund it with ${dollars(capital)} of USDC and ${dollars(gas)} of gas; never reuse a wallet that holds savings. Cost: ${dollars(capital)} of capital plus about ${dollars(gas)} of gas. Time: 10 minutes.`,
    entryAction(p.name, p.category, chain, capital, gas),
    `Check whether ${p.name} runs a points season or a waitlist and join it with this wallet before the first deposit, because a program usually scores from the day the wallet joins. Cost: nothing, and never buy an invite from a third party. Time: 10 minutes.`,
    `Repeat one qualifying action each week -- a deposit, a borrow, a swap or a vote -- for ${weeks} weeks, since programs weigh weekly activity more than a single large deposit. Cost: about ${dollars(gas)} of gas a week. Time: 15 minutes a week.`,
    `Keep the position open for at least ${hold} days so it appears in more than one monthly snapshot of the protocol's TVL. Cost: the ${dollars(capital)} stays locked, and closing early can cut the score. Time: ${hold} days.`,
    `Test the exit before you trust the deposit: withdraw a small amount once, keep ${dollars(gas)} of gas back, and approve only the allowance the app needs${thin ? '; this category has few priced peers, so size the position smaller than usual' : ''}. Cost: about ${dollars(gas)} of gas for the test. Time: 20 minutes.`,
    `Watch only ${p.name}'s own site or app for a launch or a claim notice, and never pay a fee or sign a permit to claim a token. Cost: no fee to claim, ever. Time: 10 minutes a week.`,
    `Write the wallet, every transaction hash, the deposit date and the position's value in a farm log so the position can be repeated or unwound without guesswork. Cost: nothing beyond the log. Time: 5 minutes a week.`,
  ];
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i): SnapshotProtocol => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' && p.category.trim() !== '' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate takes`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4,000 the gate takes`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug(s): ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all ${board.length} rows share one implied value`;
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one classic script: the page fetches nothing and needs no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/**
 * The build manifest the dossier shows beside the page's source: the model's constants, the market's
 * own peer figures, and the top of the board with every factor that produced each value. Written into
 * /output/dashboard/ by main.ts; it is the only dashboard file the program generates.
 */
export function previewManifest(radar: RadarData): string {
  // The manifest is a dashboard file, so it names no address: the endpoint is described in words and
  // only the fetch time is kept, and the page itself never needs either.
  const fetched = /fetched\s+(\S+)/.exec(radar.meta.source);
  const snapshot = { ...radar.meta, source: `DefiLlama protocols API, fetched ${fetched === null ? radar.meta.as_of : fetched[1]}` };
  const doc = {
    written_by: 'main.ts, from /input/snapshot.json; app.js recomputes every value from these factors',
    snapshot,
    model: {
      version: radar.model.version,
      formula: 'round(tvl_usd * peer_multiple * momentum * tenure)',
      market: radar.model.global,
      k: radar.model.peer_shrink,
      growth_weight: radar.model.growth_weight,
      tenure_ramp: [radar.model.tenure_low, radar.model.tenure_high, radar.model.tenure_days],
    },
    categories: radar.categories.slice(0, 6),
    top: radar.rows.slice(0, 6).map((r) => ({
      rank: r.rank,
      slug: r.slug,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      peer_multiple: r.factors.peer_multiple,
      peer_peers: r.factors.peer_peers,
      momentum: r.factors.momentum,
      tenure: r.factors.tenure,
      implied_value_usd: r.implied_value_usd,
    })),
  };
  return `${JSON.stringify(doc, null, 1)}\n`;
}
