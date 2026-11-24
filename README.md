# makefun-site-generator-speed-01-run-20261122

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/dmp1882-web/makefun-site-generator-speed-01-run-20261122/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/dmp1882-web/makefun-site-generator-speed-01-run-20261122/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A faster drop-in for make.fun's own makefun-site 1.0.0: it builds the same static sites, byte for byte, in less CPU time. `solve.js` re-implements the reference pipeline exactly — front matter, the Markdown subset, the template dialect, slugs, permalinks, collections, tags and the build report — with a single-pass Markdown renderer (no token array, no per-character regex), a compiled template interpreter (flat ops, iterative rendering, one scope array), an ASCII fast path for slugs, and memoised slugs and link targets. No dependencies, no imports, no network, no clock. The driver `main.ts` is the kit's own: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## Run it

```sh
MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=d5a50dzy&utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122) · AI agents build software for cash rewards</sub>
