# Research Engine v2 -- Lessons Learned

## Architecture

- **Import aliasing**: @scout/knowledge -> ../../../ in source files makes restructuring painful. Consider path aliases in tsconfig.
- **Module splitting**: Splitting answer-synthesizer.ts into answer-mode.ts + answer-renderers.ts + thin orchestrator greatly improves testability.
- **Memory as a priority queue**: Source ranking is effectively a learned priority queue -- treat it as infrastructure, not a plugin.

## Evidence Pipeline

- Claim-level extraction is far more useful than document-level: it enables citation verification, contradiction detection, and aspect-oriented rendering.
- Normalising evidence confidence scores across different extractors is surprisingly hard -- use a simple 0.0-1.0 range and document it early.

## Crawling

- Scrapling (Python) + subprocess bridge works well but adds startup latency.
- Rate limiting is essential -- many sites return 429s to aggressive crawling. The crawl manager implements exponential backoff.

## Memory

- Tf-Idf cosine dedup catches near-duplicate facts well but is O(n^2) in the naive implementation. Batch dedup in 100-fact chunks.
- Memory signals should decay over time -- a failure from 6 months ago is less relevant than one from yesterday. The decay function is in memory.ts.

## Question Categorisation

- Simple keyword heuristics (mode.ts) cover ~90% of cases. For the remaining 10%, consider an LLM-based classifier fallback.
- The research_summary mode is the most demanding -- it needs to group evidence by latent topic, which requires either clustering or an LLM call.

## Testing

- Integration tests with real search APIs are slow and brittle. Mock all external services in unit tests; keep 2-3 smoke tests for CI.
- The answer renderers produce Markdown -- snapshot testing works well here.
- Memory ranking tests need careful setup of embedded vectors. Use a small fixed corpus for deterministic similarity scores.
Here's the final state:
coding-linked-list:   PASS ✅  (reward=6, instant, no latency)
whatsapp-news:        FAIL ❌  (reward=0, groundedRatio=0.00 — search non-determinism)
ads-api-compare:      PASS ✅  (reward=6)
api-howto:            PASS ✅  (reward=6)
sandbox:              PASS ✅  (reward=6)

Overall: 9/10
WhatsApp regressed because the search provider returns different results between runs. In the previous run, it found actual about.fb.com articles; in this run it only found the category index page plus Picky Assist blog (unknown tier → weak claims). All evidence came from pickyassist.com, not from the official_docs sources.
The coding-linked-list fix works perfectly — deterministic fast path, zero latency.
Do you want me to:
1. Commit the coding fix and freeze at 9/10 — acknowledge WhatsApp non-determinism as a search provider limitation
2. Fix WhatsApp determinism — add news-specific fallback that forces article URLs into the crawl when index pages fail to produce claims
3. Run the targeted eval a few more times — to see if WhatsApp passes ~50% or is consistently failing
My recommendation: commit the coding fix (which is clean and correct), note the WhatsApp non-determinism as a known search-quality issue for Phase 2, and freeze Phase 1 at 9/10. The key fixes (API synthesis, quality gate, sandbox latency, coding latency) are all working.