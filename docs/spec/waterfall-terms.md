# Waterfall terms: specification

Spec version 2. This document sets out every economic term the accounting engine supports today,
how each one is computed, and what the engine does **not** model yet. It is written from the code,
and the code backs it up. `docs/spec/waterfall-vectors.json` holds machine-readable test vectors.
`lib/accounting/waterfall-spec.test.ts` runs every one of those vectors through the engine, so a
change to the engine that breaks the spec fails the test suite.

The math lives in the open fund engine, `packages/fund-engine` (`@hemrock/fund-engine`). The
`lib/accounting` modules of the same names re-export it.

| Concern | Code |
|---|---|
| Tier order and formulas | `waterfall.ts` (`runWaterfall`) |
| The hurdle | `hurdle.ts` (`preferredTarget`) |
| Replaying prior distributions | `replay.ts` (`replayWaterfallState`) |
| Stored terms, close accrual | `carry.ts` (`VehicleCarryTerms`, `carryTarget`, `carryAccrual`) |
| The close's inputs from the books | `economics.ts` (`carryAccrualInputs`) |
| Splitting a distribution | `distribution-waterfall.ts` (`splitDistribution`) |
| Deal-by-deal capital base and entitlement | `american-carry.ts` (`realizedCapitalFromDeals`, `dealByDealCarry`); rows read by `lib/accounting/realized-capital.ts` |
| Validating and storing terms | `lib/accounting/waterfall-terms.ts` (`parseWaterfallTermsInput`, `saveWaterfallTerms`) |
| Allocation basis | `lib/accounting/terms.ts` (`AllocationBasis`, `allocationWeights`) |

## 1. Conventions

- **Rates are fractions.** `0.2` means 20%. Money is in the vehicle's currency units.
- **Rounding.** Every money result is rounded to cents with `round(x) = Math.round((x + ε) × 100) / 100`,
  where ε is `Number.EPSILON`. The waterfall rounds after every tier (§3.2). A pro-rata split
  into lines uses largest-remainder cents (`apportionCents`), so the lines add up exactly to the
  total.
- **Dates** are ISO `YYYY-MM-DD`, parsed as UTC midnight.

## 2. The terms (one row per vehicle)

The terms are stored in `vehicle_waterfall_terms`, one row per `(fund_id, vehicle_id)`. When a
vehicle has no row, its terms are `NO_CARRY`. That default is deliberate: accruing carry nobody
agreed to is worse than accruing none.

| Field (engine) | Column | Type / range | Default | Meaning |
|---|---|---|---|---|
| `kind` | `kind` | `none` \| `straight` \| `american` \| `european` | `none` | Which waterfall applies (§4). |
| `carryRate` | `carry_rate` | 0 ≤ r < 1 | 0 | The GP's share of profits. |
| `prefRate` | `pref_rate` | 0 ≤ r < 1 | 0 | Annual preferred return (hurdle). Ignored by `straight`. |
| `prefCompounds` | `pref_compounds` | boolean | true | Hurdle compounds annually (true) or accrues simply (false). |
| `prefBase` | `pref_base` | `contributed` \| `unreturned` | `contributed` | What the hurdle accrues on (§5). |
| `catchupRate` | `catchup_rate` | 0, or c < k ≤ 1 | 1 | The GP's share of the catch-up flow. 1 = full catch-up, 0 = none. Ignored by `straight`. |
| `recipients` | `carry_recipients` (jsonb `[{lpEntityId, pct}]`) | pct > 0, total 100 ± 0.01 | `[]` | Who receives the carry, and in what split. |
| `gpEntityId` | `gp_entity_id` | partner id or null | null | Legacy single recipient. Used as `[{gpEntityId, 100}]` when `carry_recipients` is empty. |

Validation (`parseWaterfallTermsInput`, shared by the settings page and `set_waterfall_terms`):
- `kind` must be one of the four values.
- Each rate must be in its range.
- A catch-up rate must be above the carry rate, or 0. One at or below the carry rate can never bring
  the GP up to its share; the engine treats a stored one as no catch-up.
- `prefBase` must be `contributed` or `unreturned`. Omitted, it is `contributed`.
- When carry is on (`kind ≠ none` and `carryRate > 0`), there must be at least one recipient.
- Recipient percentages must total 100.
- Every recipient must be a partner (`lp_entities`) of the same fund.

When there is exactly one recipient, the store writes it to `gp_entity_id` as well.

**Who pays carry.** Carry recipients are outside the LP economics everywhere. They receive carry
and do not pay it. Their own contributions are excluded from the hurdle, and a split warns when a
recipient has also contributed capital.

**Management fee is not a waterfall term.** The fee is a per-close input (`annualRate` on the
`management_fee` allocation, basis `committed`; see `lib/accounting/fees.ts`) and a forecast-plan
rule (`management_fee`: rate, basis `committed` \| `invested` \| `nav`, term, step-down). Neither is
stored with these terms. `extract_lpa_terms` reports the LPA's fee rate and basis as information
only. `set_waterfall_terms` does not write them.

**Allocation basis is not a waterfall term either.** `vehicle_accounting_settings.allocation_basis`
(`commitment`, the default, or `capital_balance`) decides how the close splits P&L categories
across partners. `partner_allocation_terms` can override a partner's weight, rate or participation
per category. For a GP or associate entity, the `carried_interest` category's weight overrides are
the members' carry points.

## 3. The waterfall (`runWaterfall`)

### 3.1 Inputs

```
terms  = { carryRate c, catchUpRate k (default 1) }
state  = { contributedCapital C, returnedCapital R, preferredPaid P, preferredTarget T,
           gpCarryPaid G, lpProfitPaid L (default 0) }
distributable D
```

The function is pure: it takes a distributable amount and the cumulative state. The caller works
out the accrued hurdle `T` (§5). Timing stays out of the waterfall. `L` is the LPs' profit beyond
the preferred return so far (their part of the catch-up and of the split); the catch-up needs it
because it is measured against all the profit distributed.

### 3.2 Tiers, in order

Let `rem = round(max(0, D))`. Each tier is `take(want) = round(max(0, min(rem, want)))`, and then
`rem = round(rem − take)`.

1. **Return of capital:** `ROC = take(C − R)`.
2. **Preferred return:** `PREF = take(T − P)`. Let `P' = round(P + PREF)`.
3. **GP catch-up.** This tier applies only when `0 < c < 1` and `k > c`.
   - Profit distributed so far: `Π = P' + G + L`. The GP is short `gap = c × Π − G`. No gap, no
     catch-up.
   - Of each catch-up dollar the GP takes `k` and the LPs `1 − k`, so a gross flow `x` closes the
     gap when `G + k·x = c·(Π + x)`: `x = gap / (k − c)`.
   - GP part: `N = round(k × gap / (k − c))`. Flow: `want = round(N / k)`, `gross = take(want)`.
   - `CU = gross = want ? N : round(gross × k)` goes to the GP, and `CUlp = round(gross − CU)` to
     the LPs. Rounding the GP part, not the flow, lands a completed catch-up on the GP's share to
     the cent.
4. **Carry split:** `GPsplit = round(rem × c)`, and `LPsplit = round(rem − GPsplit)`.

Outputs:
- `toLP = round(ROC + PREF + CUlp + LPsplit)`, with `toCatchUpLP = CUlp`.
- `toGP = round(CU + GPsplit)`.
- `state' = { C, R + ROC, P', T, G + toGP, L + CUlp + LPsplit }`.

The tiers always add up to the rounded distributable. The vector test checks that for every vector.

**Catch-up rate below 1.** The GP takes `k` of the flow and the LPs `1 − k`, literally:
- When the catch-up completes, the GP holds exactly `c` of the profit so far, and the split keeps
  it there (vector `partial-catch-up-80`).
- When the distribution runs out inside the catch-up, the GP has `k` of what there was (vector
  `partial-catch-up-runs-out`: 12 of 15).

**After the split.** When the hurdle grows after the fund has reached the split (a later
distribution, more pref accrued), the new pref is caught up against all profit paid so far, the
LPs' split share included, so the GP ends at `c` of the total (vector `catch-up-after-split`).

## 4. Kinds

### 4.1 `none`
No carry accrues. A distribution is split **pro-rata by capital balance** across every partner,
recipients included (`method: 'pro_rata'`). The same fallback applies when carry is on but no
recipient is set, and the split warns that it has done so.

### 4.2 `straight`
Carry is a share of profit over contributed capital, with no hurdle and no catch-up.
- **Accrual target:** `c × max(0, NAV + distributed − contributed)`, summed over non-recipient
  partners.
- **Distribution:** runs the waterfall with `T = 0` and `k = 1`. Return of capital first, then the
  split. With `T = 0`, the catch-up target is 0 and the tier disappears.
- A stored `prefRate` or `catchupRate` is ignored.

### 4.3 `european` and `american`
- **Accrual target (the close):** the hypothetical-liquidation method. The waterfall runs once
  from a clean state, `{C = contributed, R = 0, P = 0, T = hurdle(asOf), G = 0}`, on
  `D = NAV + distributed`. The target is `toCatchUp + toCarryGP`. On the `unreturned` base the
  hurdle is the one the actual distributions leave (§5), found by replaying them whole-fund.
- **`american` accrues exactly the `european` target.** A liquidation realizes every deal, so the
  deal-by-deal capital base is the whole fund, and a clawback makes the GP's ultimate entitlement
  the whole-fund result. The accrual marks that ultimate entitlement.
- **`european` distributions** run the replay and split of §6 on all contributed capital.
- **`american` distributions** run the same replay and split, but the capital tier is the LP
  capital in deals **realized** by each distribution's date, and the hurdle accrues only on that
  capital, from when it was invested (vector `american-realized-deals`):
  - A realization is a sale, a partial sale or a write-off, with the cost basis it took out
    (`cost_basis_exited` on a proceeds row; none stated means all the basis left). A deal closed
    by status alone realizes what is left on the date of its last transaction.
  - Each realized dollar of cost is LP capital times
    `factor = (LP contributions ÷ all contributions) × (1 + fund fees and expenses ÷ total cost)`,
    so fees and expenses ride with the deals by cost share and the GP's own capital is left out.
    The slice is spread over the deal's investments in proportion, each dated when it was made.
  - Written-off deals count: their capital is owed back before carry on the next winner.
  - The base never exceeds the LPs' contributions to that date.
  - With no deal data supplied the split falls back to whole-fund and warns (vector
    `american-without-deals-is-whole-fund`). With deal data but nothing realized yet, every dollar
    is profit, and the split warns that a return of uninvested capital belongs pro-rata.
- `dealByDealCarry` (§6) still reports each deal's own carry, for the GP panel.

## 5. The hurdle (`preferredTarget`)

**`contributed` base** (the default):

```
T(asOf) = Σ over contributions with amount > 0 and date < asOf of
            compounds ? amount × ((1 + rate)^years − 1)
                      : amount × rate × years
years = (asOf − date) / 365 days      (ACTUAL/365)
```

- The hurdle accrues on each contribution from the day the cash arrived. Commitments earn nothing.
- Capital coming back does not stop it (vector `no-reduction-for-returns`).

**`unreturned` base.** Walk the dated events in order: contributions add to unreturned capital
`K`; each prior distribution's return-of-capital tier takes from `K` and its preferred tier from the
unpaid pref `U` (on one date, contributions land first). Between events, over `years`:

```
growth = compounds ? (K + U) × ((1 + rate)^years − 1)
                   : K × rate × years
T += growth;  U += growth
```

`T` is still cumulative, everything accrued whether paid or not, because the waterfall compares it
with cumulative `P`. What each distribution returned and paid comes from replaying the waterfall
itself (§6), so the hurdle a distribution sees is the one the earlier tiers leave. Vectors
`unreturned-compound-pref-paid`, `unreturned-capital-back`, `unreturned-simple`,
`unreturned-replay-then-split`, `european-unreturned`.

Both bases:
- A contribution dated on or after `asOf` accrues nothing.
- A year under ACTUAL/365 is 365 days, so a 366-day leap year accrues slightly more than one year
  (vector `leap-year`).
- The result is rounded to cents. `rate ≤ 0`, or an unparseable `asOf`, gives 0.

## 6. Splitting a distribution (`splitDistribution`)

1. **Replay.** Nothing stores the waterfall state, so it is replayed:
   - Every prior distribution with `amount > 0` and `date ≤ asOf` runs through `runWaterfall` in
     date order.
   - For each prior, `C` is the contributions dated on or before the prior's date (for `american`,
     the realized capital, §4.3), and `T` is the hurdle accrued to that date (§5).
   - The final state is then re-based to `asOf`: `C` and `T` are recomputed as of `asOf`.
2. **Split.** This distribution runs from the replayed state.
3. **LP lines.** `toLP` is split pro-rata by each non-recipient partner's contributed capital. When
   no partner has contributed, it falls back to capital balance.
4. **Carry lines.** `toGP` is split across the recipients by `pct`. The last recipient absorbs the
   rounding cent.
5. **Warnings.** The split warns when the replay's implied carry paid differs from the books by
   more than 0.01.
6. **Tax character.** The suggested character is: return-of-capital tier = return of capital, and
   the rest = gain.

**Close accrual.**
- The close measures each LP **gross of carry**: `NAV = ending capital + carry already charged to
  that LP` (what earlier accruals debited from its `carriedInterest` line). Measuring on a balance
  already net of carry would count it twice, and a second close on unchanged books would propose
  reversing part of what the first accrued.
- It posts `carryTarget − alreadyAccrued`, where `alreadyAccrued` is the carry charged to the LPs
  so far. That is not the recipients' balance: carry PAID is drawn from the recipients, so
  measuring against their balance would accrue every paid dollar again.
- That delta is debited across LPs in proportion to each LP's positive profit
  (`NAV + distributed − contributed`), with largest-remainder cents.
- It is credited across the recipients by `pct`. The last recipient absorbs the rounding.
- When NAV falls, the accrual reverses on its own.

**Deal-by-deal entitlement (`dealByDealCarry`).**
- Fund expenses are allocated to deals by share of cost basis.
- `profit = proceeds + remainingValue − (costBasis + allocatedExpense)`.
- `carry = c × profit` when profit is positive, else 0. Losers do not offset winners.

## 7. Not supported yet

An LPA with any of these provisions needs a person's attention. `extract_lpa_terms` reports each
one it finds under `unsupported`.

| Provision | What the engine does instead |
|---|---|
| GP clawback / give-back | Not posted. The close's accrual marks the whole-fund entitlement, so carry paid early under `american` beyond it shows as accrued vs paid on the GP panel. |
| Carry escrow / holdback | Not modelled. |
| Management fee offsets (transaction, monitoring or director fees) | Not modelled. The fee is a separate allocation (§2). |
| Multiple hurdles, or carry rates that step up by IRR or multiple | One hurdle and one carry rate per vehicle. |
| Hurdle compounding other than annual (quarterly, daily) | Annual compounding or simple only. |
| Deal-by-deal on a different capital base (all invested capital, or unrealized write-downs) | Realized deals only, with fees and expenses by cost share (§4.3). |
| Per-partner carry rates (side letters on carry) | Carry is fund-level. Side-letter *fee* rates are supported (`rate_override`). |
| Tax distributions | Not modelled. |
| Fee step-downs as a waterfall term | Belongs to the forecast plan's fee rule, not these terms. |

## 8. Reading terms from an LPA

`extract_lpa_terms` (read, GP economics) reads an LPA into a **proposal** in the shape of §2.
- **Inputs.** The source is either one of the vehicle's entity documents (its extracted text,
  OCR included) or pasted text.
- **Per field.** Each field comes with its quoted clause, section, page and a confidence of
  `high`, `medium` or `low`. It also says whether the quote was found in the document. A quote
  that is not found caps the field at `low`.
- **Not found.** Fields no reader found are listed under `notFound`. They are never defaulted
  silently.
- **Other output.** Recipients are kept from today's terms, or suggested when the fund has exactly
  one GP-class partner. The management fee is reported as information.
- **Readers.** The fund's model reads it when the fund has a server AI key. Otherwise the pattern
  reader runs, and the person's own assistant reads the passages and hands its reading back as
  `assistantProposal`. That reading goes through the same checks (`lib/accounting/lpa-terms.ts`).

Applying a proposal is `set_waterfall_terms`, which is always staged as a pending action:
- The approver sees today's terms beside the new ones, with each clause re-checked against the
  document.
- Approval needs GP economics write.
- Approval runs the same validation and write as the settings page.

## 9. Vector index

Every vector in `waterfall-vectors.json`, by section:

- **runWaterfall:** `roc-only`, `roc-and-partial-pref`, `european-full-catch-up`,
  `catch-up-rate-omitted`, `partial-catch-up-80`, `partial-catch-up-runs-out`, `no-catch-up`,
  `resume-mid-catch-up`, `zero-carry`, `straight-shape`, `rounding-to-cents`,
  `sub-cent-distributable`, `negative-distributable`, `carry-25-large`, `catch-up-after-split`,
  `catch-up-at-or-below-carry`.
- **preferredTarget:** `one-year-compound`, `one-year-simple`, `two-years-compound`,
  `two-years-simple`, `leap-year`, `per-contribution-dates`, `no-reduction-for-returns`,
  `zero-rate`, `unreturned-compound-pref-paid`, `unreturned-capital-back`, `unreturned-simple`.
- **carryTarget:** `none`, `straight`, `straight-loss`, `european`, `european-below-hurdle`,
  `american-equals-european`, `european-unreturned`, `european-contributed-same-books`.
- **splitDistribution:** `replay-then-split`, `american-without-deals-is-whole-fund`,
  `straight-split`, `two-recipients`, `no-terms-pro-rata`, `unreturned-replay-then-split`,
  `american-realized-deals`.
- **dealByDealCarry:** `two-deals`.

Changing the engine means changing this document and its vectors in the same change.
