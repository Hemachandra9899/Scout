import { describe, expect, it } from "vitest";
import { routeScoutQuery } from "../routing.service.js";

/**
 * Locks in deterministic routing for every eval query plus the M3 collision guards.
 * routeScoutQuery is a pure function, so this runs with no DB/network/stack.
 */
describe("routeScoutQuery — eval route parity", () => {
  const cases: Array<[string, string]> = [
    ["Explain the architecture of https://github.com/Hemachandra9899/Scout", "github_repo"],
    ["What is the latest important WhatsApp news?", "web_research"],
    ["Compare Meta Marketing API and Google Ads API authentication and rate limits", "web_research"],
    ["What does the Scout README say this project does?", "search_kb"],
    ["Reverse a linked list and explain time and space complexity", "direct_model"],
    ["What private salary number did the Scout founder write in a non-uploaded document yesterday?", "search_kb"],
    ["Which exact unreleased API endpoint will OpenAI launch next month?", "search_kb"],
    ["Search the project knowledge base for Scout architecture and summarize the main components", "search_kb"],
    ["How do I authenticate to the Google Ads API?", "web_research"],
    ["Given numbers [5, 2, 9, 2, 5, 10], sort them, remove duplicates, and return the mean", "sandbox"],
    // phase 3 graph routes must be unaffected by the new guards
    ["graphify this repo https://github.com/Hemachandra9899/Scout and build a code graph", "github_repo"],
    ["what entities and relations are in the repo code graph", "query_graph"],
    ["Generate GRAPH_REPORT.md for the Scout repo graph.", "query_graph"],
  ];

  for (const [query, expectedTool] of cases) {
    it(`routes "${query.slice(0, 48)}..." -> ${expectedTool}`, () => {
      expect(routeScoutQuery(query).tool).toBe(expectedTool);
    });
  }
});

describe("routeScoutQuery — M3 collision guards", () => {
  it("routes a pure-code comparison to the coding model, not web_research", () => {
    expect(routeScoutQuery("compare these two arrays in python and sort them").tool).toBe(
      "direct_model",
    );
  });

  it("keeps real API comparisons on web_research", () => {
    expect(
      routeScoutQuery("compare the Stripe API and PayPal API rate limits").tool,
    ).toBe("web_research");
  });

  it("routes an uploaded-doc question to search_kb even with API terms", () => {
    expect(
      routeScoutQuery("what does this api key in my uploaded file do").tool,
    ).toBe("search_kb");
  });
});
