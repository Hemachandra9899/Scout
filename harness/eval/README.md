# Scout Eval Harness

This eval harness measures Scout answer quality beyond smoke tests.

It records:

- routing accuracy
- actual tool used
- grounded ratio
- correctness
- completeness
- latency
- mustMention / mustNotClaim checks

## Run current RLM path

```bash
EVAL_TARGET=rlm \
RLM_RUNTIME_URL=http://localhost:8787 \
EVAL_PROJECT_ID=a26d90b1-dc27-43de-a1dd-5c961d54ca0e \
npm run eval
```

## Run direct research orchestrator path

```bash
EVAL_TARGET=web_research \
API_BASE_URL=http://localhost:8000 \
EVAL_PROJECT_ID=a26d90b1-dc27-43de-a1dd-5c961d54ca0e \
npm run eval
```

## Enable judge model

```bash
EVAL_JUDGE=1 \
MODEL_SERVICE_URL=http://localhost:8100 \
npm run eval
```

## Limit cases

```bash
EVAL_MAX_CASES=3 npm run eval
```

## Outputs

Each run writes:

* `harness-runs/<timestamp>/eval.json`
* `harness-runs/<timestamp>/summary.md`
* `harness-runs/<timestamp>/summary.csv`
* one raw response JSON per case
