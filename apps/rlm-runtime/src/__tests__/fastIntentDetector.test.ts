import { assertEquals } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { FastIntentDetector } from "./fastIntentDetector.ts";

Deno.test("FastIntentDetector - detectWithRules - greetings", async () => {
  const detector = new FastIntentDetector();

  const queries = [
    "hi",
    "hey",
    "hello",
    "sup",
    "Good morning",
    "what can you do?",
    "who are you?",
    "help",
    "thanks",
  ];

  for (const q of queries) {
    const result = await detector.detect(q);
    assertEquals(result.intent, "general");
    assertEquals(result.answerMode, "fast");
    assertEquals(result.requiredTools, []);
  }
});

Deno.test("FastIntentDetector - detectWithRules - short conversational queries", async () => {
  const detector = new FastIntentDetector();

  const queries = [
    "tell me more",
    "explain that",
    "how is that",
  ];

  for (const q of queries) {
    const result = await detector.detect(q);
    assertEquals(result.intent, "general");
    assertEquals(result.answerMode, "fast");
  }
});

Deno.test("FastIntentDetector - detectWithRules - tool keywords bypass short classification", async () => {
  const detector = new FastIntentDetector();

  const result1 = await detector.detect("write python code");
  assertEquals(result1.intent, "code");

  const result2 = await detector.detect("latest news");
  assertEquals(result2.intent, "news");
});
