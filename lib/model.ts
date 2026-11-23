// The radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// implied = TVL x peer multiple x momentum x tenure, and the peer multiple has two parts, both read
// off the snapshot: a size curve (what the market pays per dollar of TVL at this protocol's size, fitted
// on every protocol that records both a market cap and a TVL) and a category premium (how far that
// category's priced protocols sit above or below the curve, shrunk toward the market's own). See
// DESIGN.md for why the flat market median the first version used was replaced.
//
// No protocol name is ever special-cased, and a protocol whose token already trades is never scored by
// this model: it is shown at its market cap in its own view.

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
  /** Peers in a category that weigh as much as the market's own residual (the shrink weight k). */
  peer_shrink: number;
  /** Ratios outside this band are dropped before the curve is fitted. */
  ratio_min: number;
  ratio_max: number;
  /** The fitted size curve's slope is clamped here, so one outlier pair cannot invert it. */
  slope_min: number;
  slope_max: number;
  /** A size prior outside this band is a broken fit, not a finding. */
  prior_min: number;
  prior_max: number;
  /** A category's premium over the size curve is held inside this factor of the market's own. */
  premium_band: number;
  /** Momentum: weight of the seven-day change, its clip, and the factor's own bounds. */
  growth_weight: number;
  growth_clip_low: number;
  growth_clip_high: number;
  momentum_low: number;
  momentum_high: number;
  /** The exponent each adjustment is applied at: chosen on held-out error, not at full strength. */
  momentum_power: number;
  tenure_power: number;
  /** Tenure: the ramp's ends and length, and the value of an unknown age. */
  tenure_low: number;
  tenure_high: number;
  tenure_days: number;
  tenure_unknown: number;
}

export const MODEL: ModelConstants = {
  version: 'peer-3',
  peer_shrink: 20,
  ratio_min: 0.01,
  ratio_max: 40,
  slope_min: -0.75,
  slope_max: -0.05,
  prior_min: 0.005,
  prior_max: 3,
  premium_band: 2.8,
  growth_weight: 0.15,
  growth_clip_low: -60,
  growth_clip_high: 150,
  momentum_low: 0.55,
  momentum_high: 1.85,
  momentum_power: 1,
  tenure_power: 1,
  tenure_low: 0.62,
  tenure_high: 1.34,
  tenure_days: 1460,
  tenure_unknown: 0.98,
};

/**
 * The categories the house's watchlist rule treats as a product of a token that already trades, and
 * version markers in a name: the same rule applied below the floor as above it, so the radar never
 * ranks a wrapped, staked or bridged product as a token still to come.
 */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAME = /^\s*(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)/i;

/** How many token-bearing protocols the "already trades" view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The market's own size curve: ln(mcap/TVL) against ln(TVL), fitted on every priced protocol. */
export interface PeerFit {
  a: number;
  b: number;
  n: number;
}

/** A category's residual over the size curve, in log space, after the shrink toward the market. */
export interface CategoryPremium {
  peers: number;
  /** exp(median residual): the factor the category trades above or below the curve at its own size. */
  premium: number;
  p25: number;
  p75: number;
}

/** One token-bearing protocol beside a row: a comparable a reader can check the multiple against. */
export interface PeerEvidence {
  name: string;
  symbol: string;
  tvl_usd: number;
  mcap_usd: number;
  mult: number;
}

/** What the category's own priced peers say, before any shrinkage, and the row's value at their quantiles. */
export interface PeerStats {
  /** The category's priced peers, or 0 when it has none. */
  peers: number;
  /** Whether the median is the category's own peers or the whole market's, when the category is too thin. */
  basis: 'category' | 'market';
  median: number;
  /** This row's value at that median multiple, all other factors held. */
  median_usd: number;
}

/** The one factor that moves this row's value most, under a stated shock. */
export interface Driver {
  name: string;
  detail: string;
  change_pct: number;
}

/**
 * A base rate out of the snapshot's own record: of the protocols in this category and size band that
 * DefiLlama has tracked for two years or more, what share record a token today.
 */
export interface Odds {
  /** The share that records a token, 0 to 1. */
  rate: number;
  /** k of n: protocols in the cell that record a token, and protocols in it at all. */
  with_token: number;
  tracked: number;
  /** Which cell answered: the category and band, the whole category, or the whole market. */
  scope: 'category and band' | 'category' | 'market';
  label: string;
}

/** A farm plan costed in money and time, so a reader can compare protocols by return, not by prose. */
export interface Verdict {
  /** Hours of attention the plan asks for. */
  hours: number;
  /** Gas and bridge fees the plan spends, and the carry on the capital while it is locked. */
  gas_usd: number;
  carry_usd: number;
  capital_usd: number;
  /** The share of the claimed value one qualifying wallet is assumed to receive. */
  alloc_share: number;
  /** rate x alloc_share x implied value: the expected gross reward. */
  gross_usd: number;
  net_usd: number;
  per_hour_usd: number;
  per_dollar: number;
}

/** One stage of the held-out test: a model fitted on four folds and scored on the fifth. */
export interface ValidationStage {
  name: string;
  /** exp(mean ln(predicted / actual)) over held-out protocols: 1.00 is calibrated. */
  calibration: number;
  /** exp(median |ln(predicted / actual)|): the typical factor the model is out by. */
  error: number;
  /** The same at the 90th percentile of the absolute log error. */
  p90: number;
  terms: string;
}

/** The held-out record of the model, as the page shows it. */
export interface Validation {
  folds: number;
  n: number;
  stages: ValidationStage[];
  /** The momentum exponent grid's typical error, low to high, so the reader sees it is flat. */
  exponent_range: { low: number; high: number };
  chosen: { momentum_power: number; tenure_power: number };
}

/** What the page says about its own limits, in numbers where it can. */
export interface Integrity {
  stale_days: number | null;
  /** Rows whose category records fewer than three priced peers. */
  thin_rows: number;
  rows: number;
  /** Priced protocols over protocols that record a token. */
  priced: number;
  with_token: number;
  /** The calibrated offset applied to every multiple, from the held-out test. */
  bias: number;
}

/** One row of board.json. Extra keys are the model's working, kept so the page can show it. */
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
  /** On the house watchlist, above the floor but left off it, or below the floor: all three are ranked. */
  tier: 'watchlist' | 'below-floor' | 'off-list';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  factors: {
    /** The size curve's multiple at this protocol's TVL. */
    size_multiple: number;
    /** The category's factor over the curve. */
    category_premium: number;
    /** size_multiple x category_premium: the multiple the value is priced with. */
    peer_multiple: number;
    peer_peers: number;
    growth_pct: number | null;
    momentum: number;
    tenure: number;
  };
  farm_steps: string[];
  /** The two or three nearest priced peers in this category, by TVL, with their own multiples. */
  peer_evidence: PeerEvidence[];
  /** The category's priced peers as a distribution, and this row's value at their 25th, 50th and 75th multiple. */
  peer_stats: PeerStats;
  /** The single factor whose stated shock moves this value most. */
  driver: Driver;
  /** A base rate from the snapshot's own record: what share of comparable protocols carry a token. */
  odds: Odds;
  /** The plan costed in money and time: expected value per hour of attention and per dollar at risk. */
  verdict: Verdict;
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
  vs_size: number | null;
}

/** A category's evidence, for the method page. */
export interface CategoryStat {
  name: string;
  peers: number;
  premium: number;
  p25: number;
  p75: number;
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
    /** Above the floor but left off the house's watchlist: still a subject, ranked and marked. */
    off_list: number;
    tvl_in_scope: number;
  };
  validation: Validation;
  integrity: Integrity;
  model: ModelConstants & {
    fit: PeerFit;
    global: { peers: number; premium: number; p25: number; p75: number };
    /** The calibrated offset the held-out test justifies, exp(bias). */
    calibration: number;
    /** The share of the claimed value one qualifying wallet is assumed to receive. */
    alloc_share: number;
  };
  categories: CategoryStat[];
  /** Every priced protocol as a point, for the page's scatter of TVL against the multiple. */
  priced: { tvl: number; mult: number }[];
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

/** Whether a protocol is a product of another protocol's token, by the house watchlist's own rule. */
export function productOfToken(p: SnapshotProtocol): boolean {
  const category = p.category ?? '';
  return PRODUCT_CATEGORIES.has(category) || VERSIONED.test(p.name) || PRODUCT_NAME.test(p.name) || EXCHANGE_NAME.test(p.name);
}

/** ln of a protocol's market-cap-to-TVL ratio, clamped, or null when it holds no usable market cap. */
function logRatio(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.log(clamp(p.mcap_usd / p.tvl_usd, model.ratio_min, model.ratio_max));
}

/** The market's size curve: least squares of ln(ratio) on ln(TVL) over every priced protocol. */
export function fitCurve(points: { x: number; y: number }[], model: ModelConstants): PeerFit {
  const n = points.length;
  if (n < 2) return { a: 0, b: 0, n };
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  const b = sxx === 0 ? 0 : clamp(sxy / sxx, model.slope_min, model.slope_max);
  return { a: my - b * mx, b, n };
}

/** What the market pays per dollar of TVL at this size, from the fitted curve. */
export function sizePrior(tvl: number, fit: PeerFit, model: ModelConstants): number {
  if (fit.n < 2) return 1;
  const x = Math.log(clamp(tvl, 1_000_000, 1_000_000_000_000));
  return Math.exp(clamp(fit.a + fit.b * x, Math.log(model.prior_min), Math.log(model.prior_max)));
}

/** One protocol's priced record, as the table and the fit read it. */
interface Priced {
  protocol: SnapshotProtocol;
  mult: number;
  log: number;
}

/** The size curve, the priced records, and the category premiums over the curve. */
interface PeerTable {
  fit: PeerFit;
  priced: Priced[];
  /** The market's own residual quantiles, in log space, and the premium they imply. */
  global: { peers: number; median: number; p25: number; p75: number; premium: number };
  byCategory: Map<string, CategoryPremium>;
  byKey: Map<string, Priced[]>;
}

/** A category's grouping key: DefiLlama's own name, or a stand-in when it names none. */
function categoryKey(category: string | null): string {
  return category === null || category.trim() === '' ? 'Uncategorised' : category;
}

/** The peer table: the size curve fitted on every priced protocol, then each category's premium. */
function peerTable(protocols: SnapshotProtocol[], model: ModelConstants): PeerTable {
  const priced: Priced[] = [];
  for (const p of protocols) {
    const e = logRatio(p, model);
    if (e === null) continue;
    priced.push({ protocol: p, mult: p.mcap_usd! / p.tvl_usd, log: e });
  }
  const fit = fitCurve(priced.map((p) => ({ x: Math.log(p.protocol.tvl_usd), y: p.log })), model);
  const residual = (p: Priced): number => p.log - Math.log(sizePrior(p.protocol.tvl_usd, fit, model));
  const all = priced.map(residual).sort((a, b) => a - b);
  const gl = { median: median(all), p25: percentile(all, 0.25), p75: percentile(all, 0.75) };
  const span = Math.log(model.premium_band);
  const shrink = (own: number, n: number, market: number): number => {
    if (n === 0) return market;
    const blended = (n * own + model.peer_shrink * market) / (n + model.peer_shrink);
    return clamp(blended, market - span, market + span);
  };
  const byKey = new Map<string, Priced[]>();
  for (const p of priced) {
    const key = categoryKey(p.protocol.category);
    const bucket = byKey.get(key);
    if (bucket === undefined) byKey.set(key, [p]);
    else bucket.push(p);
  }
  const byCategory = new Map<string, CategoryPremium>();
  for (const [key, bucket] of byKey) {
    const own = bucket.map(residual).sort((a, b) => a - b);
    const n = own.length;
    byCategory.set(key, {
      peers: n,
      premium: round(Math.exp(shrink(median(own), n, gl.median)), 6),
      p25: round(Math.exp(shrink(percentile(own, 0.25), n, gl.p25)), 6),
      p75: round(Math.exp(shrink(percentile(own, 0.75), n, gl.p75)), 6),
    });
  }
  return { fit, priced, global: { peers: priced.length, ...gl, premium: round(Math.exp(gl.median), 6) }, byCategory, byKey };
}

/** The three factors and the value they imply for one pre-token protocol. */
export interface Score {
  implied: number;
  low: number;
  high: number;
  size: number;
  premium: number;
  calibration: number;
  peers: number;
  growthPct: number | null;
  momentum: number;
  tenure: number;
  age: number | null;
}

/**
 * The score one protocol gets under the model: TVL x size curve x category premium x momentum x tenure.
 *
 * Each factor is rounded to six places before the product, and the page recomputes the product from
 * the same rounded factors in the same order, so the number on the screen is the number in board.json
 * bit for bit rather than to within a tolerance.
 */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants, table: PeerTable, bias: number): Score {
  const age = ageDays(asOf, p.listed_at);
  const cat = table.byCategory.get(categoryKey(p.category));
  const calibration = round(Math.exp(bias), 6);
  // The curve is calibrated once, so the page can print it as one number; the premium stays pure.
  const size = round(sizePrior(p.tvl_usd, table.fit, model) * calibration, 6);
  const premium = round(cat === undefined ? table.global.premium : cat.premium, 6);
  const premiumLow = round(cat === undefined ? Math.exp(table.global.p25) : cat.p25, 6);
  const premiumHigh = round(cat === undefined ? Math.exp(table.global.p75) : cat.p75, 6);
  const peer = round(size * premium, 6);
  const peerLow = round(size * premiumLow, 6);
  const peerHigh = round(size * premiumHigh, 6);
  const adj = adjustment(p, age, model);
  const momentum = round(Math.pow(adj.momentum, model.momentum_power), 6);
  const tenure = round(Math.pow(adj.tenure, model.tenure_power), 6);
  const value = (multiple: number): number => Math.max(1, Math.round(p.tvl_usd * multiple * momentum * tenure));
  return {
    implied: value(peer),
    low: value(peerLow),
    high: value(peerHigh),
    size,
    premium,
    calibration,
    peers: cat === undefined ? 0 : cat.peers,
    growthPct: p.change_7d,
    momentum,
    tenure,
    age,
  };
}

/** The two or three nearest priced peers of a category, by TVL, with their own multiples. */
function peerEvidence(p: SnapshotProtocol, table: PeerTable, limit: number): PeerEvidence[] {
  const own = table.byKey.get(categoryKey(p.category)) ?? [];
  const pool = own.length > 0 ? own : table.priced;
  const target = Math.log(p.tvl_usd);
  return pool
    .slice()
    .sort((a, b) => Math.abs(Math.log(a.protocol.tvl_usd) - target) - Math.abs(Math.log(b.protocol.tvl_usd) - target) || bySlugOrder(a.protocol.slug, b.protocol.slug))
    .slice(0, limit)
    .map((q) => ({
      name: q.protocol.name,
      symbol: q.protocol.symbol ?? q.protocol.name,
      tvl_usd: q.protocol.tvl_usd,
      mcap_usd: q.protocol.mcap_usd ?? 0,
      mult: round(q.mult, 4),
    }));
}

/** The category's peers as a distribution, and this row's value at their 25th, 50th and 75th multiple. */
function peerStats(p: SnapshotProtocol, table: PeerTable, score: Score, model: ModelConstants): PeerStats {
  const own = table.byKey.get(categoryKey(p.category)) ?? [];
  // A median needs at least three peers to mean anything; below that the market's own is the reading.
  const useCategory = own.length >= 3;
  // Peers are compared as premiums over the size curve, because a raw multiple is only comparable at
  // the same size — which is the whole reason the curve exists.
  const premiumOfPeer = (q: Priced): number => Math.exp(q.log - Math.log(sizePrior(q.protocol.tvl_usd, table.fit, model)));
  const pool = (useCategory ? own : table.priced).map(premiumOfPeer).sort((a, b) => a - b);
  const middle = median(pool);
  return {
    peers: own.length,
    basis: useCategory ? 'category' : 'market',
    median: round(middle, 4),
    median_usd: Math.max(1, Math.round(p.tvl_usd * round(score.size * middle, 6) * score.momentum * score.tenure)),
  };
}

/**
 * The factor that most changes this row's value relative to the rest of the board: the one furthest
 * from the board's median factor, with the move to its own ceiling priced in.
 */
function driverFor(row: BoardRow, spread: { momentum: { med: number; sd: number }; tenure: { med: number; sd: number }; peer: { med: number; sd: number } }, model: ModelConstants): Driver {
  const f = row.factors;
  const applied = Math.max(1e-9, f.peer_multiple);
  const options = [
    {
      name: 'the week',
      detail: 'a +' + model.growth_clip_high + '% week at the clip\'s ceiling',
      distance: Math.abs(Math.log(f.momentum) - Math.log(spread.momentum.med)) / spread.momentum.sd,
      ratio: clamp(1 + (model.growth_clip_high / 100) * model.growth_weight, model.momentum_low, model.momentum_high) / Math.max(1e-9, f.momentum),
    },
    {
      name: 'the age',
      detail: 'four years without a token, the ramp\'s ceiling',
      distance: Math.abs(Math.log(f.tenure) - Math.log(spread.tenure.med)) / spread.tenure.sd,
      ratio: model.tenure_high / Math.max(1e-9, f.tenure),
    },
    {
      name: 'the peer multiple',
      detail: 'the category\'s 75th percentile premium',
      distance: Math.abs(Math.log(applied) - Math.log(spread.peer.med)) / spread.peer.sd,
      ratio: row.implied_high_usd / row.implied_value_usd,
    },
  ];
  let best = options[0]!;
  for (const o of options) if (o.distance > best.distance) best = o;
  return { name: best.name, detail: best.detail, change_pct: round((best.ratio - 1) * 100, 1) };
}

// ------------------------------------------------------------------ the adjustments, the calibration, the odds and the verdict

/** The two adjustments before their exponents: the week's momentum and the record's tenure. */
function adjustment(p: SnapshotProtocol, age: number | null, model: ModelConstants): { momentum: number; tenure: number } {
  const clipped = p.change_7d === null ? 0 : clamp(p.change_7d, model.growth_clip_low, model.growth_clip_high);
  return {
    momentum: clamp(1 + (clipped / 100) * model.growth_weight, model.momentum_low, model.momentum_high),
    tenure: age === null ? model.tenure_unknown : model.tenure_low + ((model.tenure_high - model.tenure_low) * Math.min(age, model.tenure_days)) / model.tenure_days,
  };
}

/** A protocol's clamped market-cap multiple, or null when it holds no usable one. */
function ratioOf(p: SnapshotProtocol, model: ModelConstants): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return clamp(p.mcap_usd / p.tvl_usd, model.ratio_min, model.ratio_max);
}

/** The category's premium over the curve, or the market's own when the category has no priced peer. */
function premiumOf(table: PeerTable, category: string | null): number {
  const c = table.byCategory.get(categoryKey(category));
  return c === undefined ? table.global.premium : c.premium;
}

/** The multiple a row is priced at from the two fitted parts alone, before any adjustment. */
function baseMultiple(p: SnapshotProtocol, table: PeerTable, model: ModelConstants): number {
  return sizePrior(p.tvl_usd, table.fit, model) * premiumOf(table, p.category);
}

/** The single calibrated offset that makes the model's average match the market's, measured on the data it was fitted to. */
function calibrationBias(table: PeerTable, priced: SnapshotProtocol[], asOf: string, model: ModelConstants): number {
  let sum = 0;
  let n = 0;
  for (const p of priced) {
    const actual = ratioOf(p, model);
    if (actual === null) continue;
    const adj = adjustment(p, ageDays(asOf, p.listed_at), model);
    const predicted = baseMultiple(p, table, model) * Math.pow(adj.momentum, model.momentum_power) * Math.pow(adj.tenure, model.tenure_power);
    sum += Math.log(actual / predicted);
    n += 1;
  }
  return n === 0 ? 0 : sum / n;
}

/** A size band, so a base rate compares protocols of the same scale. */
function tvlBand(tvl: number): string {
  return tvl >= 1_000_000_000 ? '$1B and up' : tvl >= 250_000_000 ? '$250M to $1B' : tvl >= 50_000_000 ? '$50M to $250M' : 'under $50M';
}

/** The cells a base rate is read from: category and band, category, and the whole market. */
const ODDS_MIN_TRACK_DAYS = 730;
const ODDS_MIN_CELL = 10;

function oddsCells(protocols: SnapshotProtocol[], asOf: string): Map<string, { n: number; k: number }> {
  const cells = new Map<string, { n: number; k: number }>();
  for (const p of protocols) {
    const age = ageDays(asOf, p.listed_at);
    if (age === null || age < ODDS_MIN_TRACK_DAYS) continue;
    const hasToken = !recordsNoToken(p);
    for (const key of [`${categoryKey(p.category)}|${tvlBand(p.tvl_usd)}`, `${categoryKey(p.category)}|*`, '*|*']) {
      const cell = cells.get(key) ?? { n: 0, k: 0 };
      cell.n += 1;
      if (hasToken) cell.k += 1;
      cells.set(key, cell);
    }
  }
  return cells;
}

/**
 * The odds a token appears, as a base rate from the snapshot's own record: of the protocols in this
 * category and size band that have been tracked two years or more, the share that record a token.
 */
function oddsFor(p: SnapshotProtocol, cells: Map<string, { n: number; k: number }>): Odds {
  const category = categoryKey(p.category);
  const band = tvlBand(p.tvl_usd);
  const wanted: { key: string; scope: Odds['scope']; label: string }[] = [
    { key: `${category}|${band}`, scope: 'category and band', label: `${category} at ${band}` },
    { key: `${category}|*`, scope: 'category', label: category },
    { key: '*|*', scope: 'market', label: 'the whole snapshot' },
  ];
  for (const [i, w] of wanted.entries()) {
    const cell = cells.get(w.key);
    if (cell === undefined || cell.n === 0) continue;
    const last = i === wanted.length - 1;
    if (!last && cell.n < ODDS_MIN_CELL) continue;
    return { rate: round(cell.k / cell.n, 4), with_token: cell.k, tracked: cell.n, scope: w.scope, label: w.label };
  }
  return { rate: 0, with_token: 0, tracked: 0, scope: 'market', label: 'the whole snapshot' };
}

/** The share of the claimed value one qualifying wallet is assumed to receive. Stated, not fitted. */
export const ALLOC_SHARE = 0.00001;

/**
 * A plan costed in money and time: gas and bridge fees, the carry on locked capital, the hours the
 * steps ask for, and the expected gross reward at the base rate. Its assumptions are on the page.
 */
function verdictFor(row: { implied: number; tvl_usd: number; chains: string[]; peers: number }, odds: Odds, age: number | null, steps: number): Verdict {
  const chain = row.chains.length > 0 ? row.chains[0]! : '';
  const gas = GAS[chain] ?? 4;
  const weeks = weeksFor(age);
  const hold = holdDaysFor(age);
  const capital = capitalFor(row.tvl_usd, row.peers);
  const hours = round(0.25 * steps + 0.35 * weeks, 1);
  const gasUsd = gas * (weeks + 6);
  const carryUsd = capital * 0.05 * (hold / 365);
  const gross = odds.rate * ALLOC_SHARE * row.implied;
  const net = gross - gasUsd - carryUsd;
  return {
    hours,
    gas_usd: round(gasUsd, 2),
    carry_usd: round(carryUsd, 2),
    capital_usd: capital,
    alloc_share: ALLOC_SHARE,
    gross_usd: round(gross, 2),
    net_usd: round(net, 2),
    per_hour_usd: round(net / hours, 2),
    per_dollar: round(net / capital, 4),
  };
}

// ------------------------------------------------------------------ the held-out test

type Stage = 'flat' | 'curve' | 'premium' | 'full';

/** The multiple one protocol is predicted at, under one stage and one pair of exponents. */
function stagePredict(p: SnapshotProtocol, train: PeerTable | null, flat: number, stage: Stage, asOf: string, model: ModelConstants, mp: number, tp: number): number {
  if (stage === 'flat') return flat;
  const table = train!;
  let value = sizePrior(p.tvl_usd, table.fit, model);
  if (stage !== 'curve') value *= premiumOf(table, p.category);
  if (stage === 'full') {
    const adj = adjustment(p, ageDays(asOf, p.listed_at), model);
    value *= Math.pow(adj.momentum, mp) * Math.pow(adj.tenure, tp);
  }
  return value;
}

/**
 * One stage of the model, fitted on four folds and scored on the fifth. The fit includes the single
 * calibrated offset, taken on the training folds only, so the held-out number is not flattered by it.
 */
function holdout(priced: SnapshotProtocol[], asOf: string, model: ModelConstants, stage: Stage, mp: number, tp: number): { calibration: number; error: number; p90: number; n: number } {
  const logs: number[] = [];
  for (let held = 0; held < priced.length; held += 1) {
    const test = priced[held]!;
    const train = priced.filter((_, i) => i !== held);
    const table = stage === 'flat' ? null : peerTable(train, model);
    const flat = Math.exp(median(train.map((p) => Math.log(ratioOf(p, model)!)).sort((a, b) => a - b)));
    // The calibration offset, from the training folds alone.
    let biasSum = 0;
    for (const p of train) {
      const actual = ratioOf(p, model);
      if (actual === null) continue;
      biasSum += Math.log(actual / stagePredict(p, table, flat, stage, asOf, model, mp, tp));
    }
    const bias = Math.exp(biasSum / train.length);
    const actual = ratioOf(test, model);
    if (actual === null) continue;
    logs.push(Math.log((stagePredict(test, table, flat, stage, asOf, model, mp, tp) * bias) / actual));
  }
  const abs = logs.map((l) => Math.abs(l)).sort((a, b) => a - b);
  return {
    n: logs.length,
    calibration: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length),
    error: Math.exp(median(abs)),
    p90: Math.exp(percentile(abs, 0.9)),
  };
}

/** The model's held-out record: four stages, and the exponent grid's flat surface. */
export function validateModel(snapshot: Snapshot, model: ModelConstants): Validation {
  const priced = snapshot.protocols.filter((p) => ratioOf(p, model) !== null).sort((a, b) => bySlugOrder(a.slug, b.slug));
  const stages: { stage: Stage; name: string; terms: string }[] = [
    { stage: 'flat', name: 'a flat multiple', terms: 'one market-wide median, no terms' },
    { stage: 'curve', name: '+ the size curve', terms: 'ln(mcap/TVL) against ln(TVL)' },
    { stage: 'premium', name: '+ the category premium', terms: `category residual, shrunk ${model.peer_shrink} to 1` },
    { stage: 'full', name: '+ the week and the age, the shipped model', terms: `week weight ${model.growth_weight}, tenure ramp ${model.tenure_low} to ${model.tenure_high}` },
  ];
  const measured = stages.map((s) => ({ ...holdout(priced, snapshot.as_of, model, s.stage, model.momentum_power, model.tenure_power), name: s.name, terms: s.terms }));
  let low = Infinity;
  let high = 0;
  for (const mp of [0, 1]) {
    for (const tp of [0, 1]) {
      const r = holdout(priced, snapshot.as_of, model, 'full', mp, tp);
      low = Math.min(low, r.error);
      high = Math.max(high, r.error);
    }
  }
  return {
    folds: priced.length,
    n: measured[0]!.n,
    stages: measured.map((m) => ({
      name: m.name,
      terms: m.terms,
      calibration: round(m.calibration, 3),
      error: round(m.error, 2),
      p90: round(m.p90, 2),
    })),
    exponent_range: { low: round(low, 2), high: round(high, 2) },
    chosen: { momentum_power: model.momentum_power, tenure_power: model.tenure_power },
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = peerTable(snapshot.protocols, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  const tier = new Map<string, 'watchlist' | 'below-floor' | 'off-list'>();
  // The watchlist is the floor, never the ceiling: every slug on it is on the board.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p === undefined) continue;
    chosen.set(slug, p);
    tier.set(slug, 'watchlist');
  }
  // The whole radar: every protocol whose record carries no token and that is not a wrapped, staked
  // or bridged product of one that already trades, at every size. The floor now labels a row instead
  // of filtering it, so a protocol below it is ranked and marked rather than dropped, and the floor is
  // still meaningful because every row below it says so.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !recordsNoToken(p) || productOfToken(p)) continue;
    chosen.set(p.slug, p);
    tier.set(p.slug, p.tvl_usd < snapshot.floor_usd ? 'below-floor' : 'off-list');
  }

  const priced = snapshot.protocols.filter((p) => ratioOf(p, model) !== null);
  const bias = calibrationBias(table, priced, snapshot.as_of, model);
  const cells = oddsCells(snapshot.protocols, snapshot.as_of);
  const scored = [...chosen.values()].map((p) => ({ p, score: scoreProtocol(p, snapshot.as_of, model, table, bias) }));
  scored.sort((a, b) => b.score.implied - a.score.implied || bySlugOrder(a.p.slug, b.p.slug));
  const rows: BoardRow[] = scored.map(({ p, score }, i) => {
    const plan = farmPlan(p, score.age, score.peers);
    const odds = oddsFor(p, cells);
    return {
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
      size_multiple: score.size,
      category_premium: score.premium,
      calibration: score.calibration,
      peer_multiple: round(score.size * score.premium, 6),
      peer_peers: score.peers,
      growth_pct: score.growthPct === null ? null : round(score.growthPct, 4),
      momentum: score.momentum,
      tenure: score.tenure,
    },
    farm_steps: plan.map(stepText),
    peer_evidence: peerEvidence(p, table, 3),
    peer_stats: peerStats(p, table, score, model),
    driver: { name: '', detail: '', change_pct: 0 },
    odds,
    verdict: verdictFor({ implied: score.implied, tvl_usd: p.tvl_usd, chains: p.chains, peers: score.peers }, odds, score.age, plan.length),
  };
  });
  const spread = (pick: (r: BoardRow) => number): { med: number; sd: number } => {
    const logs = rows.map((r) => Math.log(Math.max(1e-9, pick(r)))).sort((a, b) => a - b);
    const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length) || 1;
    return { med: Math.exp(median(logs)), sd };
  };
  const stats = { momentum: spread((r) => r.factors.momentum), tenure: spread((r) => r.factors.tenure), peer: spread((r) => r.factors.peer_multiple) };
  for (const row of rows) row.driver = driverFor(row, stats, model);
  return rows;
}

/** The token-bearing protocols the page shows beside the board, at the market's own value. */
export function liveRows(snapshot: Snapshot, model: ModelConstants = MODEL): LiveRow[] {
  const table = peerTable(snapshot.protocols, model);
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || bySlugOrder(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => {
      const size = sizePrior(p.tvl_usd, table.fit, model);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd,
        change_7d: p.change_7d,
        multiple: p.tvl_usd > 0 ? round(p.mcap_usd! / p.tvl_usd, 4) : null,
        vs_size: p.tvl_usd > 0 && size > 0 ? round(p.mcap_usd! / p.tvl_usd / size, 2) : null,
      };
    });
}

/** The categories with the most peers, for the method page's evidence table. */
function categoryStats(table: PeerTable): CategoryStat[] {
  return [...table.byCategory.entries()]
    .map(([name, c]) => ({ name, peers: c.peers, premium: c.premium, p25: c.p25, p75: c.p75 }))
    .sort((a, b) => b.peers - a.peers || bySlugOrder(a.name, b.name));
}

/** Everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const table = peerTable(snapshot.protocols, model);
  const bias = calibrationBias(table, snapshot.protocols.filter((p) => ratioOf(p, model) !== null), snapshot.as_of, model);
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
      with_mcap: table.global.peers,
      watchlist: snapshot.watchlist.length,
      board_size: board.length,
      below_floor: board.filter((r) => r.tier === 'below-floor').length,
      off_list: board.filter((r) => r.tier === 'off-list').length,
      tvl_in_scope: board.reduce((n, r) => n + r.tvl_usd, 0),
    },
    model: {
      ...model,
      fit: table.fit,
      global: { peers: table.global.peers, premium: table.global.premium, p25: round(Math.exp(table.global.p25), 6), p75: round(Math.exp(table.global.p75), 6) },
      calibration: round(Math.exp(bias), 4),
      alloc_share: ALLOC_SHARE,
    },
    validation: validateModel(snapshot, model),
    integrity: {
      stale_days: null,
      thin_rows: board.filter((r) => r.factors.peer_peers < 3).length,
      rows: board.length,
      priced: table.global.peers,
      with_token: tokenBearing,
      bias: round(Math.exp(bias), 4),
    },
    categories: categoryStats(table),
    priced: table.priced.map((q) => ({ tvl: q.protocol.tvl_usd, mult: Math.max(0.0001, round(q.mult, 6)) })).sort((x, y) => x.tvl - y.tvl || x.mult - y.mult),
    rows: board,
    live: liveRows(snapshot, model),
  };
  return { board, radar };
}

// ------------------------------------------------------------------ farm plans

/** The chain's fee token, for the wallet and gas lines of a plan. */
const NATIVE: Record<string, string> = {
  Ethereum: 'ETH', Arbitrum: 'ETH', Base: 'ETH', Optimism: 'ETH', 'zkSync Era': 'ETH', Linea: 'ETH', Scroll: 'ETH', Ink: 'ETH',
  Mantle: 'ETH', 'World Chain': 'ETH', Unichain: 'ETH', Katana: 'ETH', Hemi: 'ETH', BOB: 'ETH', Morph: 'ETH', 'Plume Mainnet': 'ETH',
  Binance: 'BNB', Solana: 'SOL', Polygon: 'POL', Tron: 'TRX', Avalanche: 'AVAX', Sui: 'SUI', Aptos: 'APT', Bitcoin: 'BTC',
  Stacks: 'STX', Stellar: 'XLM', Algorand: 'ALGO', Flare: 'FLR', Sonic: 'S', Berachain: 'BERA', Monad: 'MON', Plasma: 'XPL',
  'Hyperliquid L1': 'HYPE', Bittensor: 'TAO', Mezo: 'BTC', BSquared: 'BTC', Noble: 'USDC', Ripple: 'XRP', 'XRPL EVM': 'XRP',
  Pharos: 'PROS', Arc: 'USDC', Ronin: 'RON', Kava: 'KAVA', Manta: 'MANTA', Corn: 'BTC', Citrea: 'cBTC', Sei: 'SEI',
  'Fluent': 'ETH', Stable: 'USDT0', Tempo: 'USD', Provenance: 'HASH', 'Reya Network': 'ETH', 'Rise': 'ETH', 'Morph': 'ETH',
};

/** One action's gas estimate by chain: what a deposit, a borrow or a swap costs, roughly. */
const GAS: Record<string, number> = {
  Ethereum: 8, Arbitrum: 2, Base: 2, Optimism: 2, 'zkSync Era': 2, Linea: 3, Scroll: 3, Ink: 2, Mantle: 1, 'World Chain': 2,
  Unichain: 2, Katana: 2, Hemi: 3, BOB: 3, Binance: 2, Solana: 1, Polygon: 1, Tron: 2, Avalanche: 2, Sui: 1, Aptos: 2,
  Bitcoin: 6, Stacks: 3, Stellar: 1, Algorand: 1, Flare: 1, Sonic: 2, Berachain: 2, Monad: 2, Plasma: 2,
  'Hyperliquid L1': 1, Bittensor: 1, Mezo: 3, BSquared: 3, Noble: 2, Ripple: 2, 'XRPL EVM': 2, Pharos: 2, Arc: 2,
  Ronin: 1, Kava: 2, Manta: 2, Corn: 3, Citrea: 3, Sei: 2, Fluent: 2, Stable: 2, Tempo: 2, Provenance: 2, 'Reya Network': 2,
};

/** A chain whose fees and liquidity a reader usually has a wallet for already. */
const HOME_CHAINS = new Set(['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon']);

/** The family of action a category actually asks for. */
type Family =
  | 'lending' | 'cdp' | 'dex' | 'vault' | 'curator' | 'rwa' | 'basis' | 'perp' | 'restake' | 'stake'
  | 'chain' | 'bridge' | 'insurance' | 'payments' | 'stable' | 'prediction' | 'index' | 'privacy' | 'generic';

function familyOf(category: string | null): Family {
  const c = (category ?? '').toLowerCase();
  if (c.includes('cdp') || c.includes('stablecoin wrapper') || c.includes('dual-token')) return 'cdp';
  if (c.includes('lend') || c.includes('collateral') || c.includes('credit')) return 'lending';
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator') || c.includes('liquidity manager')) return 'curator';
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('decentralized btc')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'perp';
  if (c.includes('restak')) return 'restake';
  if (c.includes('staking') || c.includes('governance')) return 'stake';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'dex';
  if (c.includes('yield') || c.includes('farm') || c.includes('index')) return c.includes('index') ? 'index' : 'vault';
  if (c === 'chain') return 'chain';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('predict')) return 'prediction';
  if (c.includes('privacy')) return 'privacy';
  if (c.includes('cex') || c.includes('cedefi')) return 'generic';
  return 'generic';
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

/** One step of a farm plan: the action, what it costs and how long it takes. */
interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/**
 * How much capital one position needs: the protocol's TVL sets the tier, and the quality of the
 * evidence sets the fraction, because a category with no priced peer is a weaker claim.
 */
export function capitalFor(tvl: number, peers: number): number {
  const tier = tvl >= 5_000_000_000 ? 300 : tvl >= 1_000_000_000 ? 250 : tvl >= 250_000_000 ? 200 : tvl >= 100_000_000 ? 150 : tvl >= 50_000_000 ? 120 : 100;
  const share = peers === 0 ? 0.6 : peers < 3 ? 0.75 : peers < 5 ? 0.85 : 1;
  return Math.max(25, Math.round((tier * share) / 10) * 10);
}

/** How long to hold, from the protocol's age: a young protocol needs more than one snapshot to count. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 400) return 45;
  return 30;
}

/** The weekly cadence a season rewards: longer where the record is young and a season may still run. */
function weeksFor(age: number | null): number {
  if (age === null) return 10;
  if (age < 240) return 12;
  if (age < 730) return 9;
  return 6;
}

/** The family's entry action: the thing the protocol actually counts, with its own cost and time. */
function entryStep(family: Family, name: string, chain: string, cap: number, gas: number): FarmStep {
  const fee = dollars(cap);
  const small = dollars(Math.round(cap / 3));
  const half = dollars(Math.round(cap / 2));
  switch (family) {
    case 'lending':
      return { text: `Supply ${fee} of USDC to ${name} on ${chain}, then borrow about ${half} against it and keep the loan open, so the wallet counts as both a supplier and a borrower.`, cost: `${fee} of collateral plus about ${dollars(gas * 2)} of ${chain} gas`, time: '25 minutes' };
    case 'cdp':
      return { text: `Open a ${name} vault on ${chain}, deposit ${fee} of USDC as collateral, and mint at most ${small} of its stable asset against it rather than the maximum.`, cost: `${fee} locked as collateral plus about ${dollars(gas * 2)} of gas`, time: '30 minutes' };
    case 'dex':
      return { text: `Add ${fee} of liquidity to ${name}'s deepest pool on ${chain} in a range within about 15% of the current price, then route one small swap through the same pool each week.`, cost: `${fee} in the pool, with impermanent loss if the pair moves`, time: '30 minutes' };
    case 'vault':
      return { text: `Deposit ${fee} into one ${name} vault on ${chain} and leave it there for the whole plan; check the vault's fee and its largest allocation before you deposit.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas, and the vault's own fee`, time: '20 minutes' };
    case 'curator':
      return { text: `Deposit ${fee} into a single ${name} vault on ${chain}, after reading the curator's fee, the vault's cap and its largest borrower, since the curator's book is the risk you take.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas and the curator's fee`, time: '30 minutes' };
    case 'rwa':
      return { text: `Buy ${fee} of ${name}'s yield asset on ${chain} and hold it in the wallet that bought it; check the redemption window and the issuer before you size it.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas`, time: '20 minutes' };
    case 'basis':
      return { text: `Put on one small delta-neutral position through ${name} on ${chain}: spot on one leg, the perp on the other, so both sides are live at the same time.`, cost: `${fee} of margin plus about ${dollars(gas * 3)} of gas on two legs`, time: '35 minutes' };
    case 'perp':
      return { text: `Deposit ${fee} of USDC as margin on ${name}, open one small hedge, and keep it open across at least three funding intervals without adding size.`, cost: `${fee} at risk as margin plus about ${dollars(gas * 2)} of gas`, time: '30 minutes' };
    case 'restake':
      return { text: `Restake about ${fee} of ${chain}'s staking asset through ${name} and keep the receipt token in the same wallet rather than selling it.`, cost: `${fee} of the staking asset plus about ${dollars(gas * 2)} of gas`, time: '20 minutes' };
    case 'stake':
      return { text: `Stake about ${fee} of ${chain}'s native asset with ${name} and vote on at least one open proposal from the same wallet.`, cost: `${fee} staked plus about ${dollars(gas * 2)} of gas`, time: '20 minutes' };
    case 'chain':
      return { text: `Bridge ${fee} of USDC onto ${name} through its own bridge and deploy it in a lending app on that chain, so both the bridge and the app record the wallet.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas on two sides`, time: '35 minutes' };
    case 'bridge':
      return { text: `Bridge ${fee} of USDC to ${chain} through ${name} and use the funds in an app on the far side instead of letting them sit in the bridge.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas on two sides`, time: '30 minutes' };
    case 'insurance':
      return { text: `Buy ${fee} of cover from ${name} on ${chain} and keep the policy to its full term, since a cancelled policy usually scores nothing.`, cost: `the premium on ${fee} of cover`, time: '15 minutes' };
    case 'payments':
      return { text: `Route ${fee} of USDC through ${name} on ${chain} in four separate payments over a month and keep each receipt.`, cost: `${fee} moved plus about ${dollars(gas * 4)} of gas in all`, time: '15 minutes a month' };
    case 'stable':
      return { text: `Mint ${name}'s stable asset against ${fee} of collateral on ${chain} and hold the minted asset, so both the collateral and the supply side show in the wallet.`, cost: `${fee} of collateral plus about ${dollars(gas * 2)} of gas`, time: '25 minutes' };
    case 'prediction':
      return { text: `Fund ${fee} on ${name} and take positions in three separate markets over a month, including at least one market that settles within the week.`, cost: `${fee} at risk across the positions`, time: '20 minutes a week' };
    case 'index':
      return { text: `Buy ${fee} of ${name}'s index token on ${chain} and hold it in the buying wallet instead of rebalancing it yourself.`, cost: `${fee} plus about ${dollars(gas)} of gas`, time: '15 minutes' };
    case 'privacy':
      return { text: `Deposit ${fee} of USDC through ${name}'s shielded pool on ${chain}, withdraw part of it a week later, and keep the withdrawal notes.`, cost: `${fee} plus about ${dollars(gas * 3)} of gas on two transactions`, time: '20 minutes' };
    default:
      return { text: `Deposit ${fee} of USDC into ${name} on ${chain} through its own app and keep the position open for the whole plan.`, cost: `${fee} plus about ${dollars(gas * 2)} of gas`, time: '20 minutes' };
  }
}

/** The family's exit test: what a reader must prove works before the money is committed. */
function exitStep(family: Family, name: string, chain: string, gas: number): FarmStep {
  const g = dollars(gas);
  switch (family) {
    case 'lending':
      return { text: `Before you rely on it, repay the borrowed leg and withdraw a small part of the supply once; interest accrues second by second, so repay the debt first.`, cost: `about ${g} of gas for the round trip`, time: '20 minutes' };
    case 'cdp':
      return { text: `Prove the exit first: repay the minted debt and only then withdraw collateral, because a vault that is liquidated while you withdraw loses the whole position.`, cost: `about ${g} of gas for both transactions`, time: '20 minutes' };
    case 'dex':
      return { text: `Withdraw a small slice of the liquidity once and read how much of each token comes back; that gap is impermanent loss, and it is the real cost of the position.`, cost: `about ${g} of gas for the round trip`, time: '15 minutes' };
    case 'vault':
    case 'curator':
      return { text: `Withdraw a small amount once and check that the shares redeem at the price the app showed; a vault with a queue or a lock-up will say so only at that moment.`, cost: `about ${g} of gas for the round trip`, time: '20 minutes' };
    case 'rwa':
      return { text: `Read the redemption terms before buying: how many days the issuer takes to pay out, and whether redemption is in kind or in cash.`, cost: 'nothing to read', time: '15 minutes' };
    case 'basis':
    case 'perp':
      return { text: `Close both legs once on a small position to prove the exit; on a perp venue, the liquidation price moves with the funding rate.`, cost: `about ${dollars(gas * 3)} of gas and the spread on both legs`, time: '20 minutes' };
    case 'restake':
    case 'stake':
      return { text: `Read the unbonding period before staking: the asset is locked for that long, which is usually longer than the farm itself.`, cost: 'nothing to check', time: '10 minutes' };
    case 'chain':
    case 'bridge':
      return { text: `Test the return path with a small amount before the full deposit: bridge fees and wait times are not symmetric, and the way back can take longer.`, cost: `about ${dollars(gas * 2)} of gas for the test`, time: '30 minutes' };
    default:
      return { text: `Withdraw a small amount once to prove the exit works and that the app does not hold withdrawals behind a queue.`, cost: `about ${g} of gas for the round trip`, time: '20 minutes' };
  }
}

/**
 * A protocol's farm plan, derived from its own record: the category decides the qualifying action and
 * its exit test, the first chain decides the wallet and the gas, the TVL tier and the priced-peer count
 * decide the position size, the seven-day change decides whether to split the entry, and the age decides
 * whether a points season is plausible and how long the hold must be. The steps that do not apply are
 * not written, so plans run from a few steps on an old, quiet protocol to a dozen on a young one that
 * needs a bridge, a cadence and a hold.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, peers: number): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const native = NATIVE[chain] ?? 'the chain\'s own fee token';
  const gas = GAS[chain] ?? 4;
  const cap = capitalFor(p.tvl_usd, peers);
  const hold = holdDaysFor(age);
  const steps: FarmStep[] = [];

  steps.push({
    text: `Open a fresh wallet on ${chain} funded with ${dollars(cap)} of USDC and about ${dollars(gas * 3)} of ${native} for fees, keep its seed offline, and fund it from an exchange rather than a wallet that holds savings.`,
    cost: `${dollars(cap)} of capital plus about ${dollars(gas * 3)} of ${native}`,
    time: '10 minutes',
  });

  if (p.chains.length >= 5) {
    steps.push({
      text: `${p.name} counts TVL on ${p.chains.length} chains. Pick one of them for the whole position instead of spreading it, because a farm that is split across chains usually scores on none of them.`,
      cost: 'nothing to choose, and it saves a bridge fee', time: '10 minutes',
    });
  }
  if (!HOME_CHAINS.has(chain)) {
    steps.push({
      text: `Bridge the ${dollars(cap)} to ${chain} from a chain you already use, and keep about ${dollars(gas)} of its own fee token on both sides so the return trip is not stuck.`,
      cost: 'about 0.1% bridge fee plus a few dollars of gas on each side', time: '15 to 40 minutes, depending on the bridge',
    });
  }

  steps.push(entryStep(familyOf(p.category), p.name, chain, cap, gas));

  if (p.change_7d !== null && p.change_7d <= -10) {
    steps.push({
      text: `Its TVL fell ${Math.abs(p.change_7d).toFixed(1)}% this week. Enter in two halves a week apart rather than all at once, and check that the app's withdrawals work before the second half goes in.`,
      cost: 'nothing extra, and it costs one week of time', time: 'one week between the halves',
    });
  } else if (p.change_7d !== null && p.change_7d >= 300) {
    steps.push({
      text: `Its TVL jumped ${p.change_7d >= 1000 ? 'more than 1,000' : Math.round(p.change_7d)}% this week, which is an incentive launch or a migration rather than organic demand. Enter the smaller half now and expect the TVL to fall back before it grows again.`,
      cost: 'half the position up front', time: 'about a week to see whether the TVL holds',
    });
  } else if (p.change_7d !== null && p.change_7d >= 25) {
    steps.push({
      text: `Its TVL rose ${p.change_7d.toFixed(1)}% this week, which usually means an incentive has just started and the qualifying bar is rising with the crowd. Enter now rather than waiting for a better week.`,
      cost: 'nothing extra', time: 'the entry day',
    });
  }

  const season = age === null ? 'unknown' : age < 120 ? 'new' : age < 1095 ? 'live' : 'old';
  if (season !== 'old') {
    steps.push({
      text: season === 'new'
        ? `${p.name} is ${age} days into DefiLlama's record, so a first season is likely to open rather than to have closed. Register the wallet in its app before the first deposit.`
        : `Check ${p.name}'s own app for a live season or points page and register this wallet before the first deposit, because a program usually scores from the day the wallet joins.`,
      cost: 'nothing, and never buy an invite from a third party', time: '10 minutes',
    });
    const weeks = weeksFor(age);
    const heavy = gas >= 6;
    steps.push(heavy
      ? {
        text: `Then make a qualifying action every two weeks for ${weeks} weeks, with two actions per visit; a program counts a wallet that keeps coming back, and batching the actions keeps gas under the position's size on ${chain}.`,
        cost: `about ${dollars(gas * 2)} of gas every two weeks`, time: `${weeks} weeks, 20 minutes every two weeks`,
      }
      : {
        text: `Then make one qualifying action each week for ${weeks} weeks; a program weighs a wallet that acts weekly more than one large deposit on a single day.`,
        cost: `about ${dollars(gas)} of gas a week`, time: `${weeks} weeks, 15 minutes each`,
      });
  }

  steps.push({
    text: `Keep the position open for at least ${hold} days so it appears in more than one monthly snapshot of the protocol's TVL.`,
    cost: `the ${dollars(cap)} stays locked, and closing early can cut the score`, time: `${hold} days`,
  });

  steps.push(exitStep(familyOf(p.category), p.name, chain, gas));

  steps.push({
    text: `Watch only ${p.name}'s own site or app for a launch or a claim notice, and never pay a fee or sign a permit to claim a token.`,
    cost: 'no fee to claim, ever', time: '10 minutes a week',
  });

  if (peers < 3) {
    steps.push({
      text: `This category has ${peers === 0 ? 'no' : peers === 1 ? 'one' : peers} priced token${peers === 1 ? '' : 's'} in the snapshot, so its multiple is mostly the market's size curve. Size the position at the smaller figure and treat the value as a range.`,
      cost: 'the position is smaller, not the risk', time: '10 minutes to reconsider',
    });
  }
  steps.push({
    text: `Write the wallet, every transaction hash, the deposit date and the position's value in a farm log, so the position can be repeated or unwound without guesswork.`,
    cost: 'nothing beyond the log', time: '5 minutes a week',
  });

  return steps;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you act.`;
  return s;
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
 * The build manifest the dossier shows beside the page's source: the fitted size curve, the categories'
 * premiums and the top of the board with every factor that produced each value. Written into
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
      formula: 'round(tvl_usd * size_multiple * category_premium * momentum * tenure)',
      curve: radar.model.fit,
      market: radar.model.global,
      k: radar.model.peer_shrink,
      growth_weight: radar.model.growth_weight,
      tenure_ramp: [radar.model.tenure_low, radar.model.tenure_high, radar.model.tenure_days],
    },
    categories: radar.categories.slice(0, 3),
    top: radar.rows.slice(0, 3).map((r) => ({
      rank: r.rank,
      slug: r.slug,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      size_multiple: r.factors.size_multiple,
      category_premium: r.factors.category_premium,
      peer_multiple: r.factors.peer_multiple,
      peer_peers: r.factors.peer_peers,
      momentum: r.factors.momentum,
      tenure: r.factors.tenure,
      implied_value_usd: r.implied_value_usd,
      farm_steps: r.farm_steps.length,
    })),
  };
  return `${JSON.stringify(doc, null, 1)}\n`;
}
