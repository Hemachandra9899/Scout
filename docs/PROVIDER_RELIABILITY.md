# Provider Reliability

Scout does not require Firecrawl.

Default provider posture:

1. Tavily
2. GitHub
3. Local fetch for seeded/known URLs
4. Firecrawl only when explicitly enabled

Env flags:

```bash
FIRECRAWL_ENABLED=false
TAVILY_ENABLED=true
GITHUB_SEARCH_ENABLED=true
LOCAL_CRAWL_ENABLED=true
BRAVE_SEARCH_ENABLED=false
```

Debug signals:

- providerFallbackUsed
- exhaustedProviders
- selectedProviders
- skippedProviders
- providerErrors

Quota/rate-limit errors do not fail the whole run if another provider succeeds.
