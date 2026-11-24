# LeadFlow test and type-check baseline

This records the state of the existing tests and TypeScript checks **before** Claude Code makes any change.
It is not a to-do list: the owner has decided these existing failures are **not** to be fixed as part of
unrelated work. The rule for every future change is simply:

> **No new failing test files, and no new TypeScript errors in the files the change touches.**

## When and on what
- Commit: `589990773ac260148c48c01d6a647eefbb0f283f` (`main`, 2026-11-24)
- Still valid at `dde2450` (first Claude Code release): that release added one passing test file
  (`server/dayBoardSchedulerTabLabel.test.ts`, 541 files in total) and the same 110 files fail; TypeScript count unchanged.
- Node 22, pnpm 10.4.1, dependencies installed with `pnpm install --frozen-lockfile`
- Run in Claude Code's sandbox with **internet switched off** (`unshare -n`) and **no environment variables or keys**,
  so no test could reach a real database, send a message, place a call or charge a card.

## Results
| Check | Result | Detail |
|---|---|---|
| Tests (vitest) | **430 of 540 test files pass**; 110 fail | ~11,000 of 11,500 individual tests pass. Two identical runs gave the **same 110 failing files** (no flaky files). List: `baseline/failing-test-files.txt` |
| TypeScript (`tsc --noEmit`) | **582 existing errors in 107 files** | Count per file: `baseline/typescript-errors-by-file.tsv` |
| Production build (`pnpm build`) | **Succeeds** | The build does not type-check, so the 582 errors do not stop deploys |

Most of the 110 failing test files fail for environmental reasons in an offline sandbox (no database, no network,
timing-sensitive tests, tests that read git history or production-only configuration). They were not investigated
further, by design.

## How to compare after a change
Run these from the repository root (they are safe: offline, no keys):

```bash
# 1. Tests — all of them, offline, with a JSON report
unshare -n env -i PATH="$PATH" HOME="$HOME" TZ=America/New_York npx vitest run --reporter=json --outputFile=/tmp/vitest-after.json

# 2. TypeScript — needs extra memory
unshare -n env -i PATH="$PATH" HOME="$HOME" NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit > /tmp/tsc-after.txt
```

Then compare:
- Every test file that failed after the change must already be in `baseline/failing-test-files.txt`.
- For each file the change touched, its TypeScript error count must be no higher than in `baseline/typescript-errors-by-file.tsv`
  (files not listed there have 0 and must stay at 0).
- Tests written for the change itself must pass.

If the baseline ever needs refreshing (for example after a change that Manus pushes to `main`), re-run both commands
on the new `main` and replace the two files in `baseline/`, noting the new commit above.
