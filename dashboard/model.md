# The model behind the board

The radar answers one question per protocol and only that question:

> If this protocol's record stayed exactly as the snapshot shows it, what would a token that claims the
> protocol be worth?

It does not forecast that a token will be issued, and it does not rank protocols by fame. The board is
a valuation of a claim, with its arithmetic on the page.

## One formula, three inputs

```
implied = TVL × peer(category) × momentum(change_7d) × tenure(age)
```

### 1. TVL — the size of the claim

The protocol's TVL in whole dollars, straight from the snapshot. Nothing scales it before the peer
multiple: the multiple is where the market's own reading enters.

### 2. peer(category) — what the market already pays for a dollar of TVL

The snapshot carries protocols whose token already trades *and* a market cap. Each of those records is
one reading of `mcap / TVL`. The model collects all of them, clamps each ratio to the interval in
`constants.ratio_min … ratio_max`, and takes the log-median. That single number is the market-wide
multiple; it is not typed in anywhere.

A category's own peers are a better reference, but categories are thin — most hold one or two priced
protocols. So the category's log-median is shrunk toward the market's own:

```
peer(c) = exp( (n·ln R_c + k·ln M) / (n + k) )
```

with `n` the category's priced peer count, `R_c` its log-median ratio, `M` the market's, and `k = 5`
the prior's weight. A category with five peers weighs as much as the market prior; a category with one
peer is mostly the market's own figure. The result is held inside `M / band … M × band` so a two-peer
category cannot claim a multiple the market never pays.

Each row on the board names its multiple and its peer count. The detail view names the token-bearing
protocols the multiple was read from, with their own market cap, TVL and ratio.

### 3. momentum(change_7d) — the last week

```
momentum = clamp(1 + weight · clamp(change_7d, clip_low, clip_high) / 100, low, high)
```

The clip stops one bad or good week from deciding a ranking; the weight makes a 10% week worth about
4.5% of value, not 10%. A protocol with no seven-day reading takes a neutral 1.00.

### 4. tenure(age) — how long it has run with no token

```
tenure = low + (high - low) · min(age_days, days) / days
```

`age_days` is the whole days from the protocol's first day in DefiLlama's record to the snapshot's
`as_of`. At listing the factor is `low`; after `days` (four years) it is `high` — the two ends differ by more than a factor of two, so tenure separates two protocols of the same size and the same week. The reading: a
protocol that has carried its TVL through a cycle has a durable claim on a token, while one tracked for
eight weeks may be a single incentive programme. A protocol with no listing date takes the midpoint.

## The band

The row's `implied_low_usd` and `implied_high_usd` are the same product with the peer multiple at the
category's shrunk 25th and 75th percentile: how much the market disagrees with itself about this
category. The board ranks on the point estimate and draws the band behind it as a bar, on a log scale
across the rows on screen.

## The split the board keeps

- **A protocol whose token already trades is never scored.** Its value is the market's market cap, and
  it is shown in the *Token trades* view on its own, with the ratio the model reads from it. Mixing a
  model's claim into a traded market cap would make the ranking meaningless.
- **A protocol whose record carries no token is scored.** The page says "records no token", never
  "has none": a record is not proof, and the watchlist's own definition is the house's reading of
  DefiLlama, not a fact about the world.
- **No protocol name is special-cased.** The same function scores all rows; the only per-row inputs are
  the snapshot's own figures.

## Farm plans

Every row carries eight steps derived from the protocol's record — its category, its first chain, its
TVL tier and its age. A step that asks for money says what it costs; a step that takes time says how
long. Capital, gas and the hold window move with the TVL tier and the age, so two protocols never get
the same sentences from a hand-written list.

## Where the numbers come from, and how to check them

- `../data.js` is written by `main.ts` from `/input/snapshot.json`: the board rows with their raw
  figures and their factors, the token-bearing records, and the constants.
- `board-preview.json` in this directory is the generated build manifest: the constants, the market's
  peer figures, the categories, and the top of the board with every factor that produced each value.
- `app.js` recomputes every row's value from its own rounded factors in the same order the model took
  them, and the footer reports how many rows it reproduced. The model rounds each factor to six places
  before the product, so the number on the screen is the number in `board.json`, not a near miss.
- The page needs no network: two classic scripts, one stylesheet, no fonts, no images, no fetch.
