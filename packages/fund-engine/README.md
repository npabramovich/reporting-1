# @hemrock/fund-engine

The fund-accounting math behind Hemrock Portfolio, as a standalone package you can read, test and
run yourself. It has no database, no framework and no runtime dependencies. Every function is a
function of its arguments, so you can reproduce any number the app shows from the books it was
computed from.

The app uses this package directly. `lib/accounting/*` re-exports it (see "Use in the app"), so
the code here is the same code that runs in production, not a copy of it.

## What is in it

| Module | What it does |
| --- | --- |
| `ledger.ts`, `types.ts` | Double-entry primitives: cent rounding, the balance check, account and per-partner balances. |
| `trial-balance.ts` | The trial balance, plus period scoping (`postingsInPeriod`, `postingsAsOf`). |
| `capital-account.ts` | The capital-account roll-forward: source type to statement line, period statements, NAV and the tie-out check. |
| `allocation.ts` | Pro-rata allocation that ties to the cent (largest remainder), including the cumulative residual variant the close uses. |
| `waterfall.ts` | One distribution through the tiers: return of capital, then preferred return, then GP catch-up, then the carry split. |
| `hurdle.ts` | The preferred return, on contributed or on unreturned capital. |
| `replay.ts` | Where the tiers stand on a date: every earlier distribution replayed, whole-fund or on realized deals. |
| `carry.ts` | The carry target on a hypothetical liquidation at NAV, and the per-LP accrual. Also `carryTermsFromRow`, which reads stored terms. |
| `american-carry.ts` | Deal-by-deal (American): the realized-capital base a distribution returns before carry, and each deal's carry on fully-loaded cost. |
| `distribution-waterfall.ts` | Splits a distribution by replaying every earlier distribution through the waterfall. |
| `economics.ts` | Turns capital postings into the inputs for the carry accrual and the distribution split. The close and the distribution preview both use it. |
| `text-ledger.ts` | Writes the books to plain-text double-entry, and parses that text back. This is the format the app exports. |
| `books.ts` | Builds a chart, postings and partner capital postings from parsed text. |
| `xirr.ts` | XIRR (Newton's method with several starting guesses). |
| `cli.ts`, `terms-file.ts` | The `fund-engine` command line and its terms file. |

## Command line

You need Node 22.18 or later, which runs the TypeScript source directly. If the package has been
built (`npm run build`), the CLI runs the built `dist/` instead.

```sh
# From the repository root
node packages/fund-engine/bin/fund-engine.mjs statements \
  --ledger packages/fund-engine/examples/books.ledger \
  --terms packages/fund-engine/examples/terms.json --format table

node packages/fund-engine/bin/fund-engine.mjs waterfall \
  --ledger packages/fund-engine/examples/books.ledger \
  --terms packages/fund-engine/examples/terms.json --amount 600000
```

### `fund-engine statements`

```
fund-engine statements --ledger <books.ledger> --terms <terms.json>
                       [--as-of YYYY-MM-DD] [--from YYYY-MM-DD]
                       [--include-drafts] [--format json|table]
```

Reads a plain-text ledger and prints the following:

- **The trial balance**, with a check that debits equal credits.
- **Each partner's capital-account roll-forward**: beginning, contributions, distributions, fees,
  expenses, income, realized and unrealized gains, FX, transfers, carried interest and ending.
  Every roll-forward is checked to tie.
- **NAV**, with a check that it equals the balance of the partner capital accounts in the trial
  balance.
- **The carry accrual the period close would post**, measured as a hypothetical liquidation at
  NAV. This shows the target entitlement, what is already accrued, and the difference to post,
  split per LP.

`--as-of` defaults to the date of the last posted entry. With `--from`, the output is a period
statement: activity before that date rolls into beginning capital. Draft entries (`!`) are left
out unless you pass `--include-drafts`, because the app's statements use posted entries only.
Unbalanced or unparseable entries stop the run with exit code 1. A usage error exits with 2.

### `fund-engine waterfall`

```
fund-engine waterfall --terms <terms.json> --amount <N>
                      [--ledger <books.ledger>] [--as-of YYYY-MM-DD]
                      [--format json|table]
```

Shows how a distribution of `N` splits across the tiers, the LP lines and the carry lines. It also
shows the suggested tax character and the waterfall state before and after the distribution.

- **With `--ledger`:** the tier state is replayed from every earlier distribution in the books,
  with the hurdle accrued to each distribution's date. This is exactly what the app's
  distribution preview does.
- **Without `--ledger`:** the run starts from the terms file's `state`, and the LP share is split
  by commitment.

### The ledger format

The ledger format is what the app's `export_ledger_text` tool (and `serializeLedger`) writes:

```
2024-01-15 * "Capital call 1 (50%)"
  source: "capital_call"
  ref: "call:1"
  Assets:Due-From-LPs:1300  500000.00 USD
  Equity:Partners-Capital-Alpha-Pension:3100-aaaaaaaa  -300000.00 USD
  Equity:Partners-Capital-Beta-Family-Office:3100-bbbbbbbb  -200000.00 USD
```

- Each account is named `Root:Name:Code`. The root (`Assets`, `Liabilities`, `Equity`, `Income`,
  `Expenses`) gives the account type. The last component is the chart code.
- Amounts are signed: debits are positive and credits are negative.
- The `source:` metadata is the journal source type. The roll-forward puts each posting on a
  statement line by its source type.
- A partner's capital account is an equity account whose code matches `^3100-.+`, which is the
  app's per-partner capital code. You can change the pattern with `capitalAccountPattern`.
- One posting per entry may leave out its amount. The parser fills it in to balance the entry.

### terms.json

```jsonc
{
  "vehicle": "Sample Fund I",           // optional, a label for the output
  "carry": {
    "kind": "european",                  // "none" | "straight" | "european" | "american"
    "carryRate": 0.2,                    // GP share of profit, as a fraction
    "prefRate": 0.08,                    // preferred return (hurdle), annual fraction; ignored for "straight"
    "catchupRate": 1,                    // GP share during catch-up; 1 = full, 0 = none, else above carryRate
    "prefCompounds": true,               // compound the hurdle annually (default true); false = simple
    "prefBase": "contributed",           // hurdle on "contributed" capital (default) or "unreturned" capital
    "recipients": [                      // who receives the carry; pct must sum to 100
      { "partner": "gp", "pct": 100 }
    ]
  },
  "partners": [                          // optional; maps capital accounts to ids and names
    { "id": "lp-alpha", "name": "Alpha Pension", "account": "3100-aaaaaaaa", "commitment": 600000 },
    { "id": "gp", "name": "Sample GP", "account": "3100-c0ffee00" }
  ],
  "capitalAccountPattern": "^3100-.+",   // optional regular expression over chart codes
  "state": {                             // optional; used by `waterfall` when there is no --ledger
    "contributedCapital": 1000000,
    "returnedCapital": 0,
    "preferredPaid": 0,
    "preferredTarget": 80000,
    "gpCarryPaid": 0,
    "lpProfitPaid": 0                    // LPs' profit beyond the pref so far (default 0)
  },
  "realizedCapital": [                   // optional, "american" only: LP capital in realized deals
    { "companyId": "deal-a", "date": "2024-03-01", "realizedOn": "2025-06-30", "amount": 400000 }
  ]
}
```

- **Rates are fractions.** Write `0.2` for 20%. A value above 1 is rejected.
- **Recipients and partners.** A recipient's `partner` is a partner `id`. A capital account that is
  not listed under `partners` is reported under its code, for example `3100-aaaaaaaa`.
- **Snake_case keys.** The stored `vehicle_waterfall_terms` column names (`carry_rate`,
  `pref_rate`, `catchup_rate`, `pref_compounds`, `gp_entity_id`, `carry_recipients`) are also
  accepted inside `carry`.
- **Carry kinds.** `european` and `american` accrue the same whole-fund target. American carry only
  changes when carry is paid, not how much is earned in total; see the note in `carry.ts`. An
  `american` distribution returns the capital in deals realized so far (`realizedCapital`, built by
  `realizedCapitalFromDeals`) before carry; without it the split is whole-fund and warns.
  `dealByDealCarry` computes each deal's own carry.
- **The full spec** is `docs/spec/waterfall-terms.md` in the repository, with test vectors.

## Examples and the golden test

`examples/` contains a small sample fund:

- `books.ledger`: the books, produced by `serializeLedger` from `test/fixture.ts`. A test checks
  that the file stays byte-for-byte identical to what the serializer writes.
- `terms.json`: the sample fund's terms.
- `expected-statements.json` and `expected-waterfall.json`: the CLI's expected output.

`test/golden.test.ts` runs the CLI on the sample, both in-process and through `bin/`, and compares
the output to the expected files. If you change the math on purpose, regenerate the expected
files with the commands above, redirected to the files, and review the diff.

## Use in the app

The repository's `tsconfig.json` maps `@hemrock/fund-engine` to `src/index.ts`, and
`vitest.config.ts` has the same alias. Next.js (Turbopack), tsx and the esbuild scripts all honour
the tsconfig path, so the app compiles the engine from source with no build step and no
workspace install. `lib/accounting/{ledger,types,waterfall,carry,american-carry,
distribution-waterfall,allocation,capital-account,text-ledger}.ts` and `lib/xirr.ts` are thin
re-exports. `carry.ts` also keeps `loadCarryTerms`, which reads the database, and `statements.ts`
keeps the statements that are not yet in the engine.

Imports inside the package use explicit `.ts` extensions. This is what lets Node run the source
directly. The build (`tsconfig.build.json`) rewrites them to `.js`.

## Known differences from the app

- **Imported QuickBooks or Carta entries.** The app reclassifies simple cash and capital exchanges
  on these entries for the roll-forward (`cash-capital-source.ts`), and that needs the database
  chart. The CLI uses the entry's `source:` as written. Ending capital ties either way; only the
  line a posting lands on can differ.
- **Currencies.** Postings in different currencies are summed together, as the app's capital
  account sums them. The CLI warns when the ledger has more than one currency.

## Scripts

```sh
npm run typecheck   # tsc over src/
npm run build       # emit dist/ (ESM + .d.ts)
npm test            # vitest (from the repository root: npx vitest run packages/)
```

Licensed under the Apache License, Version 2.0.
