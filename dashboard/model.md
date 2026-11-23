# The model behind the board

The radar answers one question per protocol and only that question:

> If this protocol's record stayed exactly as the snapshot shows it, what would a token that claims the
> protocol be worth?

It does not forecast that a token will be issued. The board is a valuation of a claim, with its
arithmetic on the screen.

## One formula, two parts to the peer

```
implied = TVL × peer × momentum(change_7d) × tenure(age)
peer    = size curve(TVL) × category premium(category)
```

### 1. The size curve — what the market pays at this size

The snapshot carries protocols whose token already trades *and* a market cap. Each is one reading of
`mcap / TVL`, and in this snapshot that ratio falls with size: a median of 0.33× under $100M of TVL,
0.13× from $100M to $300M, 0.08× from $300M to $1B and 0.03× from $1B to $10B. A least-squares fit of
`ln(ratio)` on `ln(TVL)` over the 128 priced protocols gives `ln(ratio) = 5.941 − 0.416·ln(TVL)`: the
same dollar of TVL is worth 0.24× at $50M and 0.07× at $1B. Nothing here is typed in; the curve is the
snapshot's own cross-section.

### 2. The category premium — how far a category sits above the curve

Every priced protocol sits some factor above or below the curve at its own size. A category's premium is
the median of its own peers' factors over the curve, shrunk toward the market's own median with a weight
of **k = 5** peers:

```
premium(c) = exp( (n·R_c + k·R_market) / (n + k) )      held inside 2.8× of the market's
```

Seven peers outweigh the market prior; one does not. The detail view prints both parts of the multiple
and the priced protocols the premium was read from, each with its own multiple against the curve.

### 3. momentum(change_7d) — the last week

```
momentum = clamp(1 + 0.45 · clamp(change_7d, −60, +150) / 100, 0.55, 1.85)
```

A 10% week moves value about 4.5%, not 10%, and the clip stops one week from deciding a rank. A protocol
with no seven-day reading takes a neutral 1.00.

### 4. tenure(age) — how long it has run with no token

```
tenure = 0.62 + 0.72 · min(age_days, 1460) / 1460
```

`age_days` runs from the protocol's first day in DefiLlama's record to the snapshot's `as_of`. At listing
the factor is 0.62; after four years it is 1.34, so tenure separates two protocols of the same size and
the same week by more than a factor of two. A protocol with no listing date takes the midpoint, 0.98.

## The band

`implied_low_usd` and `implied_high_usd` are the same product with the category premium at its own 25th
and 75th residual: how much the market disagrees with itself about this category. The board ranks on the
point estimate and draws the band behind it as a bar, on a log scale across the rows on screen.

## The split the board keeps

- **A protocol whose token already trades is never scored.** Its value is the market's market cap, and
  it is shown in the *Token trades* view with its multiple against the curve. Those records are the fit
  and the premiums; mixing a model's claim into a traded market cap would make the ranking meaningless.
- **A protocol whose record carries no token is scored.** The page says "records no token", never "has
  none": a record is not proof.
- **A product is not a launch.** Below the floor the board applies the house's own watchlist rule and
  leaves out wrapped, staked, bridged and versioned products, so an LST is never ranked as a token still
  to come.
- **No protocol name is special-cased.** The same function scores all rows.

## Farm plans

Every plan is derived from the protocol's own record, and steps that do not apply are not written, so
plans run from six steps to twelve. The category picks the qualifying action and the exit test — a CDP
mint, a vault deposit, a delta-neutral pair, a restake and a bridge transfer are different plans with
different risks to prove out. The first chain picks the wallet and the gas and adds a bridge when it is
not a chain a reader already has. TVL and the priced-peer count pick the position size. The seven-day
change decides whether to split the entry. The age decides whether a points season is plausible, the
weekly cadence and the hold window.

## Where the numbers come from, and how to check them

- `../data.js` is written by `main.ts` from `/input/snapshot.json`: the rows with their raw figures and
  every factor, the token-bearing records, the fitted curve and the premiums.
- `board-preview.json` in this directory is the generated build manifest: the fit, the premiums, the
  categories and the top of the board with every factor that produced each value.
- `app.js` recomputes every row from its own rounded factors in the same order the model took them, and
  the footer reports how many it reproduced — all of them on this snapshot. Each factor is rounded to
  six places before the product, so the number on the screen is the number in `board.json`.
- The page needs no network: two classic scripts, one stylesheet, no fonts, no images, no fetch.
