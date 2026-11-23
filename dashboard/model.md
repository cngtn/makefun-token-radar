# The model behind the board

The radar answers one question per protocol and only that question:

> If this protocol's record stayed exactly as the snapshot shows it, what would a token that claims the
> protocol be worth?

It does not forecast that a token will be issued. The board is a valuation of a claim, with its
arithmetic and its out-of-sample error on the screen.

## The formula

```
implied = TVL × peer × momentum(change_7d) × tenure(age)
peer    = size curve(TVL) × category premium(category)
```

The **size curve** is fitted on every protocol in the snapshot that records both a market cap and a TVL.
Each is one reading of `mcap / TVL`, and in this snapshot that ratio falls with size: 0.33× under $100M
of TVL, 0.08× from $300M to $1B, 0.03× from $1B to $10B. A least-squares fit of `ln(ratio)` on `ln(TVL)`
gives `ln(ratio) = 5.941 − 0.416·ln(TVL)`, so a dollar of TVL is worth 0.24× at $50M and 0.07× at $1B.
The curve is then multiplied by one calibrated offset (about 1.07×) so that its average matches the
market's; that offset is the only free scalar in the model.

The **category premium** is each priced protocol's residual over that curve, by category, shrunk toward
the market's own with a weight of 20 peers and capped at 2.8×. A weight of 5 made the held-out error
worse, so the categories move the multiple only a little.

**Momentum** enters at weight 0.15, clipped to −60% to +150%: at the 0.45 the first version used, the
held-out test got worse. **Tenure** ramps 0.62× to 1.34× over four years without a token; an
unrecorded age takes the neutral 0.98×.

## Held-out test

Leave-one-out: the whole model is refitted on 127 priced protocols and scored on the one held out, 128
times. Typical error is the factor a prediction is out by, at the median.

| Model | Calibration | Typical error | 90th |
| --- | --- | --- | --- |
| a flat multiple | 1.000 | 4.79× | 24.7× |
| + the size curve | 1.000 | 3.52× | 25.6× |
| + the category premium | 1.002 | 3.35× | 26.7× |
| + the week and the age | 1.002 | 3.36× | 29.6× |

The curve is the term the record supports: 3.52× against 4.79× for a flat multiple. The premium adds a
little. Turning the week and the age off moves the error by 0.01×, inside the noise of 128 records, so
those two are declared terms at weights the noise can carry, not fitted ones. The page prints the table
so a reader can disagree with the choice.

## The band

`implied_low_usd` and `implied_high_usd` are the same product with the premium at the category's 25th
and 75th residual. The board ranks on the point estimate and draws the band behind it as a bar.

## What the board separates

- **A protocol whose token already trades is never scored.** It is shown in *Token trades* with its
  multiple against the curve. Those records are the fit and the premiums.
- **A product is not a launch.** The board applies the house's watchlist rule at every size and leaves
  out wrapped, staked, bridged and versioned products: 144 of this snapshot's 342 pre-token records.
- **The floor marks, it does not filter.** Every record the rule admits is ranked, and a row below the
  $50M floor says so on the board instead of disappearing.
- **A record is not proof.** The page says "records no token", never "has none".

## Odds and verdicts

Each row carries a base rate from the record: of the protocols in its category and size band tracked
two years or more, the share that record a token, with the k of n printed in the detail view. The
verdict multiplies that rate by an assumed 0.001% share of the claimed value per qualifying wallet,
subtracts the plan's gas and the carry on locked capital, and divides by the hours the plan asks for.
Both assumptions are printed beside the number, and the verdict is linear in the share.

## Comparables on every row

Each row names its two or three nearest priced peers by TVL, with their ticker, their TVL and their own
`mcap / TVL`, and prices the row at the peers' median **premium over the curve** — a raw multiple is
only comparable at the same size, which is the whole reason the curve exists. A line says what the
value would be at that median and at the category's 25th to 75th premium; another names the one factor
— the week, the age or the peer multiple — that would move the value most, with the move priced in.

## What the model does not do

The page prints its own limits: a sealed snapshot, most rows on under three priced peers, a curve that
rests on the third of token-bearing protocols that carry a market cap, a held-out error it states, odds
that are a base rate from a list of survivors, and no prediction of a launch or its date.

## Where the numbers come from

`../data.js` is written by `main.ts` from `/input/snapshot.json`; `board-preview.json` is the build manifest; `app.js` recomputes every row from its rounded factors and the footer reports how many it reproduced. No network, no fonts, no images.
