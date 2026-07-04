# Scout Eval Harness

## Overview

The harness evaluates Scout's router and research pipeline against a suite of test cases.
Each case specifies expected routing, content requirements, and pass/fail thresholds.

## Structure

```
harness/
  eval/
    cases/              # JSON test cases
    run-eval.mjs        # Run eval suite
    analyze-run.mjs     # Analyze a completed run
    harness-reward.mjs  # Reward computation
    harness-trajectory.mjs  # Per-case timing traces
  run-research-benchmark.mjs  # Research benchmark runner
harness-runs/           # Eval output (gitignored except .gitkeep)
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run harness:eval` | Run full router eval suite |
| `npm run harness:ci` | CI gate: eval + threshold checks |
| `npm run harness:analyze <run-dir>` | Analyze a completed run |
| `npm run harness:research` | Run research benchmark |

Backward-compatible aliases: `npm run eval`, `npm run eval:ci`, `npm run eval:analyze`, `npm run benchmark:research`.

## CI Gate

`npm run eval:ci` gates on:

| Gate | Env Var | Threshold |
|------|---------|-----------|
| Mean correctness | `EVAL_FAIL_UNDER` | ≥ 0.7 |
| Pass rate | `EVAL_GATE_PASS_RATE` | ≥ 0.9 |
| Mean reward | `EVAL_GATE_MIN_REWARD` | ≥ 5.0 |
| Routing accuracy | `EVAL_GATE_ROUTING` | ≥ 1.0 (100%) |

All gates must pass or the process exits with code 1.

Also requires clean typechecks:

```bash
npm run typecheck:api && npm run typecheck:knowledge && npm run typecheck:web
```

## Adding a Case

Create a JSON file in `harness/eval/cases/`:

```json
{
  "id": "my-case-001",
  "query": "What is X?",
  "intent": "research",
  "expectedTier": 2,
  "expectedTool": "web_research",
  "mustMention": ["key term"],
  "mustMentionAnyGroups": [["O(n)", "linear"]],
  "mustNotClaim": ["O(n^2)"],
  "referenceAnswer": "Expected answer summary",
  "minGroundedRatio": 0.7,
  "minCorrectness": 0.7,
  "minCompleteness": 0.7,
  "maxLatencyMs": 120000
}
```

## Run Output

Each run produces:

```
harness-runs/<timestamp>/
  01-case-id.json              # Raw response + eval row
  01-case-id.trajectory.json   # Timing trace
  eval.json                    # Full results (aggregate + rows)
  summary.md                   # Human-readable report
  summary.csv                  # Machine-readable summary
  analysis.md                  # Post-analysis (if run)
```
