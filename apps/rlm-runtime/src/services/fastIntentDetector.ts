
/**
 * Runtime-local fast intent detection for the RLM sandbox loop.
 * The API router source of truth is:
 * packages/knowledge/src/router/intent-classifier.ts
 */

import { ModelClient } from "./modelClient.ts";
import type { ChatMessage } from "../types.ts";

export type FastIntentName = "github_repo" | "news" | "web_research" | "kb" | "code" | "document" | "general";
export type FastIntent = {
  intent: FastIntentName;
  requiresFreshness: boolean;
  requiresWeb: boolean;
  requiresGithub: boolean;
  requiredTools: string[];
  answerMode: "fast" | "deep";
  reason: string;
};

const DEFAULT: FastIntent = {
  intent: "general",
  requiresFreshness: false,
  requiresWeb: false,
  requiresGithub: false,
  requiredTools: [],
  answerMode: "fast",
  reason: "No fast-intent rule matched.",
};

function githubRepo(query: string): string | null {
  const m = query.match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  return m ? `${m[1]}/${m[2].replace(/\.git$/i, "")}` : null;
}
function has(q: string, regs: RegExp[]) { return regs.some((r) => r.test(q)); }
function tools(v: unknown): string[] {
  const allowed = new Set(["search_kb","web_research","crawl_url","query_graph","github_repo"]);
  return Array.isArray(v) ? [...new Set(v.map(String).filter((x) => allowed.has(x)))] : [];
}
function parseJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text.trim()) as Record<string, unknown>; } catch {}
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
}
function normIntent(v: unknown): FastIntentName {
  const s = String(v ?? "");
  return (["github_repo","news","web_research","kb","code","document","general"] as string[]).includes(s) ? s as FastIntentName : "general";
}

export class FastIntentDetector {
  constructor(private readonly modelClient = new ModelClient()) {}
  async detect(query: string): Promise<FastIntent> {
    const hard = this.detectWithRules(query); if (hard) return hard;
    if (Deno.env.get("FAST_INTENT_DISABLE_MODEL") === "1") return DEFAULT;
    try {
      const raw = await this.modelClient.chatFastIntent(this.messages(query));
      const j = parseJson(raw); if (!j) return DEFAULT;
      const requiredTools = tools(j.requiredTools);
      return {
        intent: normIntent(j.intent),
        requiredTools,
        answerMode: j.answerMode === "deep" ? "deep" : "fast",
        requiresFreshness: Boolean(j.requiresFreshness),
        requiresWeb: Boolean(j.requiresWeb) || requiredTools.includes("web_research"),
        requiresGithub: Boolean(j.requiresGithub) || requiredTools.includes("github_repo"),
        reason: typeof j.reason === "string" ? j.reason : "Classified by fast intent model.",
      };
    } catch { return DEFAULT; }
  }
  private detectWithRules(query: string): FastIntent | null {
    const q = query.trim().toLowerCase();
    
    // Greeting / Capability / Conversational Rules
    const greetings = [
      /^(hi|hey|hello|yo|sup|thanks|thank\s+you|gm|gn|good\s+morning|good\s+afternoon|good\s+evening)\b/i,
      /\b(what\s+can\s+you\s+do|who\s+are\s+you|what\s+are\s+you|help\s+me|help)\b/i,
    ];
    
    const wordCount = q.split(/\s+/).filter(Boolean).length;
    // If it's a bare conversational/short question <= 3 words, and doesn't contain tool indicators (api, doc, news, git, etc)
    const isShortConversation = wordCount <= 3 && 
      !has(q, [
        /\b(api|sdk|docs?|github|http|www|web|news|latest|fix|debug|code|write|run|git|pdf|csv|xls|file|upload)\b/i
      ]);

    if (has(q, greetings) || isShortConversation) {
      return {
        intent: "general",
        requiresFreshness: false,
        requiresWeb: false,
        requiresGithub: false,
        requiredTools: [],
        answerMode: "fast",
        reason: "Deterministic greeting/conversational rule matched."
      };
    }

    const repo = githubRepo(query);
    if (repo) return { intent:"github_repo", requiresFreshness:false, requiresWeb:true, requiresGithub:true, requiredTools:["github_repo"], answerMode:"fast", reason:`GitHub repo URL detected (${repo}); use github_repo, not crawl_url.` };
    if (has(q,[/\b(readme|about.*project|tell me about|what.*codebase|documentation page)\b/i])) return { intent:"kb", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:["search_kb"], answerMode:"fast", reason:"Project/README/documentation query; search_kb is appropriate." };
    if (has(q,[/\b(news|latest|current|today|recent|new update|breaking|announcement|announced)\b/i,/\bwhatsapp\b/i,/\bwhat'?s app\b/i])) return { intent:"news", requiresFreshness:true, requiresWeb:true, requiresGithub:false, requiredTools:["web_research"], answerMode:"fast", reason:"Current/news query; web_research is mandatory." };
    if (has(q,[/\b(api|sdk|docs?|documentation|oauth|auth|authentication|permission|rate limits?|integration|webhook|endpoint)\b/i,/\b(compare|comparison|versus|vs)\b/i])) return { intent:"web_research", requiresFreshness:true, requiresWeb:true, requiresGithub:false, requiredTools:["web_research"], answerMode:"fast", reason:"API/docs/research query; web_research is mandatory." };
    if (has(q,[/\b(uploaded|file|pdf|document|spreadsheet|csv|attachment|my doc|this doc)\b/i])) return { intent:"document", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:["search_kb"], answerMode:"fast", reason:"Uploaded/local document query." };
    if (has(q,[/\b(write code|debug|fix code|implement|refactor|script|function|class|typescript|python|sql)\b/i])) return { intent:"code", requiresFreshness:false, requiresWeb:false, requiresGithub:false, requiredTools:[], answerMode:"deep", reason:"Coding/sandbox query." };
    return null;
  }
  private messages(query: string): ChatMessage[] {
    const systemPrompt = `You are a fast intent classifier. Classify the user query into one of: github_repo, news, web_research, kb, code, document, general.
Guidelines:
1. Choose "general" with "answerMode": "fast" for conversational inputs, greetings (hi, hello, etc.), capability questions (what can you do?), and simple questions that don't need external web/doc research.
2. Choose "web_research" or "news" with "answerMode": "fast" only when external sources or current information are required.
3. Choose "github_repo" when a GitHub link is present.
4. Choose "kb" or "document" when the user asks about project documentation, codebase structure, or uploaded files.
5. Choose "code" with "answerMode": "deep" for requests asking to write, debug, refactor or fix code blocks.

Return JSON only in this format:
{"intent":"github_repo|news|web_research|kb|code|document|general","requiresFreshness":boolean,"requiresWeb":boolean,"requiresGithub":boolean,"requiredTools":["search_kb"|"web_research"|"crawl_url"|"query_graph"|"github_repo"],"answerMode":"fast|deep","reason":string}`;
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ];
  }
}
