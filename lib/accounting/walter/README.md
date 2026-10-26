# Walter conformance

[Walter](https://github.com/tdavidson/walter) is an open spec for fund terms: the terms and dated
flows go in, every allocation the terms imply comes out, and a set of vectors says what the right
answer is. This folder runs Portfolio's accounting engine on those vectors.

- `adapter.ts` translates Walter's terms and flows into what the books hold and calls the engine
  (`splitDistribution`, `carryTarget`, `clawbackAtFundEnd`) for every number. It does no
  waterfall math of its own. A term the engine can't express is refused as `unsupported`.
- `vectors/` and `compare.ts` are copied from the Walter repo, unchanged. Copy them again when
  the spec moves.
- `conformance.test.ts` runs every vector in `npm test`. Each must pass unless it's in `GAPS`,
  with what the engine is missing.

To refresh the spec repo's compatibility table:

```
WALTER_RESULTS=../walter/results/portfolio-accounting.json npx vitest run lib/accounting/walter
```
