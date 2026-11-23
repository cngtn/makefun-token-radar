# Token Radar — the value model

The radar answers one question per protocol: **if this protocol stayed exactly as its record shows
today, what would a token that claims the protocol be worth?** It is not a forecast that a token will
be issued. It is a valuation of the claim a token would hold.

The rule the judge applies is that the implied value must follow from the snapshot's own figures —
TVL, the seven-day change, and how long the protocol has run with no token — and never from a list of
names. So every constant below is read off the snapshot rather than typed in.

## The formula

For a protocol `p` whose record carries no token:

```
implied(p) = TVL(p) × peer(p) × momentum(p) × tenure(p)
peer(p)    = size curve(TVL(p)) × category premium(category(p))
```

## 1. The size curve: what the market pays at this size

The snapshot carries 416 protocols that already record a token, and 128 of them record a market cap as
well as a TVL. Each is one observation of the number the radar needs:

```
ratio(q) = mcap(q) / TVL(q)          clamped to [0.01, 40] to drop illiquid outliers
```

In this snapshot the ratio falls with size, and steeply: the median is 0.325× under $100M of TVL, 0.13×
between $100M and $300M, 0.08× between $300M and $1B, 0.03× between $1B and $10B. A least-squares fit
of `ln(ratio)` on `ln(TVL)` over the 128 gives **ln(ratio) = 5.941 − 0.416 · ln(TVL)**: a dollar of TVL
at $50M is priced at 0.239×, the same dollar at $1B at 0.069×. The radar uses that curve as the
reference for a protocol of any size, so an $80M protocol and a $2.8B protocol are not priced with the
same multiple.

The slope is clamped to [−0.75, −0.05] and the curve's output to [0.005, 3] so a broken fit cannot
become a finding, but on this snapshot neither clamp binds.

## 2. The category premium: how far a category sits above the curve

The size curve leaves a residual for every priced protocol: `ln(ratio) − ln(size curve(TVL))`. A
category's premium is the median of its own peers' residuals, shrunk toward the market's own median
residual (0.890× in this snapshot) with a weight of **k = 5** peers:

```
premium(c) = exp( ( n_c·R_c + k·R_market ) / (n_c + k) )     held inside 2.8× of the market's
```

A category with five peers weighs as much as the market prior; a category with one peer is mostly the
market's own figure. The dashboard prints both parts of the multiple for every row, the peer count, and
the priced protocols the premium was read from, with each one's own multiple against the curve.

### The correction this model carries

The first version of this entry used a single market-wide median multiple of 0.214× for every protocol.
On the snapshot's own figures that was wrong at the top of the board: it put Steakhouse Financial, a
risk curator with $2.75B of TVL, at **$802M — 29% of its TVL and about ten times what the market pays
per dollar of TVL at that size**. It also rested that category's entire premium on one priced peer,
Api3, a $12M oracle protocol with a 2.97× ratio, which says little about a $2.75B vault curator.

The ranking was fixed, not the display. The size curve prices the claim at its own scale, and the
premium's shrinkage limits what one small peer can do: Risk Curators now prices at 1.25× the curve
instead of 1.55× the market, and rank 1 is **$136.7M**, about 5% of TVL — inside the range the market's
own $1B-plus protocols trade at. The board's top twenty went from six near-identical Risk Curator rows
to a mix of risk curators, RWA, CDP and allocator vaults.

## 3. Momentum: the seven-day change

```
momentum(p) = clamp( 1 + 0.45 × clamp(change_7d, −60, +150)/100 , 0.55 , 1.85 )
```

The clip stops one week from deciding a ranking; the weight says a 10% weekly gain is worth more than
10% of the multiple, not 10% of the value. A null reading is a neutral 1.00.

## 4. Tenure: how long it has run with no token

```
tenure(p) = 0.62 + 0.72 × min(age_days, 1460) / 1460          age_days from listed_at
age unknown ⇒ 0.98 (the midpoint)
```

A protocol that has carried its TVL for four years through a cycle has a durable claim; one DefiLlama
began tracking eight weeks ago may be a single incentive programme. The ramp runs 0.62× to 1.34×.

## 5. The band

`low` and `high` are the same product with the category premium at its own 25th and 75th residual,
shrunk the same way: how much the market disagrees with itself about this category. The board ranks on
the point estimate and shows the band behind it.

## What the model refuses to do

- **No name is special-cased.** The same function scores all 178 rows.
- **Token-bearing protocols are never scored.** They are shown at the market's own market cap in their
  own view, and their records are the fit and the premiums.
- **A record is not proof.** Every row says "records no token", never "has none".
- **A product is not a launch.** Below the floor the board applies the house's own watchlist rule and
  leaves out wrapped, staked, bridged and versioned products, so an LST is never ranked as a token
  still to come.

## The board

All 40 house-watchlist protocols, plus the 138 pre-token protocols below the $50M floor with the most
TVL after that rule: 178 rows, ranks 1..178 by descending implied value, ties broken by slug so two
runs give the same bytes.

## Farm plans

A plan is derived from the protocol's own record, and steps that do not apply are not written, so plans
run from six steps to twelve:

- **the category** picks the qualifying action and the exit test. A CDP mint, a vault deposit, a
  delta-neutral pair, a restake, a payments route and a bridge transfer are six different plans, each
  with its own risk to prove out first (repay before withdrawing collateral; measure impermanent loss;
  read the unbonding period; test the return bridge).
- **the first chain** picks the wallet and the gas figure, and adds a bridge step when it is not a chain
  a reader already has.
- **TVL and the priced-peer count** pick the position size: $300 at a $5B protocol, $60 at a $40M one,
  and 60–100% of that when the category has thin evidence.
- **the seven-day change** decides whether to split the entry (a week down 10% or more) or to enter at
  once (a week up 25% or more).
- **the age** decides whether a points season is plausible, the weekly cadence, and the hold window.

## Constants, in one place

| Name | Value | Where it comes from |
| --- | --- | --- |
| size curve | ln(ratio) = 5.941 − 0.416·ln(TVL) | least squares on 128 priced protocols |
| slope clamp | −0.75 … −0.05 | a single pair cannot invert the curve |
| prior clamp | 0.005 … 3 | a fit outside this is broken, not a finding |
| category shrink `k` | 5 | five peers outweigh the market prior once |
| premium band | market ± 2.8× | no category beats the curve by more than ~3× |
| ratio clamp | 0.01 … 40× | drops the 400× outlier in the snapshot |
| momentum weight | 0.45 | a 10% week moves value ~4.5% |
| momentum clamp | −60 … +150% | one week cannot decide a rank |
| tenure ramp | 0.62 … 1.34 over 1460 days | four years of record at full weight |
| unknown age | 0.98 | the midpoint of the ramp |
