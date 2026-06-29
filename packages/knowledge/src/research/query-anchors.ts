export type AnchorGroup = {
  label: string;
  terms: string[];
  required: boolean;
};

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function extractQueryAnchors(query: string): string[] {
  const q = query.toLowerCase();
  const anchors: string[] = [];

  const known = [
    "WhatsApp",
    "Meta Marketing API",
    "Meta",
    "Google Ads API",
    "Google Ads",
    "OAuth",
    "OAuth 2.0",
    "access token",
    "developer token",
    "rate limit",
    "rate limits",
    "quota",
    "quotas",
    "authentication",
  ];

  for (const item of known) {
    if (q.includes(item.toLowerCase())) anchors.push(item);
  }

  const capitalized =
    query.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*){0,3}\b/g) ?? [];

  for (const phrase of capitalized) {
    if (
      phrase.length >= 4 &&
      !["What", "How", "Compare", "Latest", "Given"].includes(phrase)
    ) {
      anchors.push(phrase);
    }
  }

  return unique(anchors).slice(0, 10);
}

export function requiredAnchorGroupsForQuery(query: string): AnchorGroup[] {
  const q = query.toLowerCase();
  const groups: AnchorGroup[] = [];

  if (q.includes("whatsapp")) {
    groups.push({
      label: "WhatsApp",
      terms: ["whatsapp", "whatsapp messenger"],
      required: true,
    });
  }

  if (q.includes("meta marketing api") || q.includes("meta") && q.includes("api")) {
    groups.push({
      label: "Meta Marketing API",
      terms: ["meta marketing api", "marketing api", "graph api", "meta"],
      required: true,
    });
  }

  if (q.includes("google ads api") || q.includes("google ads")) {
    groups.push({
      label: "Google Ads API",
      terms: ["google ads api", "google ads", "developer token"],
      required: true,
    });
  }

  if (q.includes("auth") || q.includes("authentication") || q.includes("oauth")) {
    groups.push({
      label: "Authentication",
      terms: ["authentication", "oauth", "oauth 2.0", "access token", "developer token"],
      required: false,
    });
  }

  if (q.includes("rate limit") || q.includes("quota")) {
    groups.push({
      label: "Rate limits",
      terms: ["rate limit", "rate limits", "quota", "quotas", "limits"],
      required: false,
    });
  }

  if (q.includes("compare")) {
    groups.push({
      label: "Comparison coverage",
      terms: ["difference", "comparison", "versus", "vs"],
      required: false,
    });
  }

  return groups;
}

export function buildFocusedResearchQueries(query: string): string[] {
  const q = query.toLowerCase();
  const queries = new Set<string>();
  queries.add(query);

  if (q.includes("whatsapp")) {
    queries.add("WhatsApp latest important news official blog");
    queries.add("WhatsApp latest updates official announcement");
    queries.add("site:blog.whatsapp.com WhatsApp latest news");
    queries.add("site:about.fb.com/news WhatsApp latest");
  }

  if (q.includes("meta marketing api") || q.includes("meta")) {
    queries.add("Meta Marketing API authentication access token official docs");
    queries.add("Meta Marketing API rate limits official docs");
    queries.add("site:developers.facebook.com Meta Marketing API authentication rate limits");
  }

  if (q.includes("google ads api") || q.includes("google ads")) {
    queries.add("Google Ads API authentication OAuth developer token official docs");
    queries.add("Google Ads API rate limits quotas official docs");
    queries.add("site:developers.google.com/google-ads/api OAuth developer token");
  }

  return unique([...queries]).slice(0, 6);
}

export type RequiredSynthesisGroup = {
  label: string;
  terms: string[];
  required: boolean;
};

export type SynthesisGroupResult = {
  label: string;
  present: boolean;
  terms: string[];
};

export function requiredSynthesisGroupsForQuery(query: string): RequiredSynthesisGroup[] {
  const q = query.toLowerCase();
  const groups: RequiredSynthesisGroup[] = [];

  if (q.includes("auth") || q.includes("authentication") || q.includes("api")) {
    groups.push({
      label: "OAuth",
      terms: ["oauth 2.0", "oauth"],
      required: true,
    });

    groups.push({
      label: "Access token",
      terms: ["access token"],
      required: true,
    });
  }

  if (q.includes("google ads api") || q.includes("google ads")) {
    groups.push({
      label: "Developer token",
      terms: ["developer token"],
      required: true,
    });
  }

  if (
    q.includes("rate limit") || q.includes("rate limits") ||
    q.includes("quota") || q.includes("compare") ||
    q.includes("api")
  ) {
    groups.push({
      label: "Rate limits or quotas",
      terms: ["rate limit", "rate limits", "quota", "quotas", "limits"],
      required: true,
    });
  }

  return groups;
}

export function missingRequiredSynthesisGroups(answer: string, query: string): string[] {
  const answerLower = answer.toLowerCase();

  return requiredSynthesisGroupsForQuery(query)
    .filter((group) => group.required)
    .filter((group) => !group.terms.some((term) => answerLower.includes(term)))
    .map((group) => group.label);
}

export function buildApiSynthesisTemplate(query: string): string {
  const groups = requiredSynthesisGroupsForQuery(query);
  if (groups.length === 0) return "";

  const sections = groups.map((g) => `- ${g.label}:`).join("\n");

  return [
    "",
    "For API authentication or comparison queries, use this structure:",
    "",
    "## Authentication",
    `- OAuth:`,
    `- Access token:${query.toLowerCase().includes("google ads") ? "\n- Developer token:" : ""}`,
    "",
    "## Rate limits / quotas",
    "- State what the evidence says.",
    "- If exact numeric limits are not found, say that exact limits were not found in the retrieved evidence.",
    "",
    query.toLowerCase().includes("compare")
      ? [
          "## Key differences",
          "- Compare the systems directly.",
          "",
        ].join("\n")
      : "",
    "Do not omit a required section. If evidence is missing, write \"Evidence not found\" for that section.",
  ].filter(Boolean).join("\n");
}
