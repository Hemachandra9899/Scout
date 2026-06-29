export type OfficialSourceSeed = {
  label: string;
  domains: string[];
  queries: string[];
  urls?: string[];
};

export function officialSourceSeedsForQuery(query: string): OfficialSourceSeed[] {
  const q = query.toLowerCase();
  const seeds: OfficialSourceSeed[] = [];

  if (q.includes("whatsapp")) {
    seeds.push({
      label: "WhatsApp",
      domains: ["blog.whatsapp.com", "about.fb.com"],
      queries: [
        "site:blog.whatsapp.com WhatsApp latest news",
        "site:blog.whatsapp.com WhatsApp latest updates",
        "site:about.fb.com/news WhatsApp latest news",
        "WhatsApp latest important news official blog",
      ],
      urls: ["https://blog.whatsapp.com/"],
    });
  }

  if (q.includes("meta marketing api") || (q.includes("meta") && q.includes("api"))) {
    seeds.push({
      label: "Meta Marketing API",
      domains: ["developers.facebook.com"],
      queries: [
        "site:developers.facebook.com Meta Marketing API authentication access token",
        "site:developers.facebook.com Meta Marketing API rate limits",
        "site:developers.facebook.com Marketing API access token rate limits",
      ],
      urls: [
        "https://developers.facebook.com/docs/marketing-apis/",
        "https://developers.facebook.com/docs/marketing-api/overview/",
      ],
    });
  }

  if (q.includes("google ads api") || q.includes("google ads")) {
    seeds.push({
      label: "Google Ads API",
      domains: ["developers.google.com"],
      queries: [
        "site:developers.google.com/google-ads/api OAuth developer token",
        "site:developers.google.com/google-ads/api authentication OAuth",
        "site:developers.google.com/google-ads/api rate limits quotas",
      ],
      urls: [
        "https://developers.google.com/google-ads/api/docs/oauth/overview",
        "https://developers.google.com/google-ads/api/docs/get-started/dev-token",
      ],
    });
  }

  return seeds;
}

export function officialDomainsForQuery(query: string): string[] {
  return [...new Set(officialSourceSeedsForQuery(query).flatMap((seed) => seed.domains))];
}
