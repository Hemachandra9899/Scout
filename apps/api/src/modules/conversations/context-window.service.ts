const DEFAULT_MAX_CONTEXT_CHARS = Number(
  process.env.MAX_CHAT_CONTEXT_CHARS || 24_000,
);

export function buildConversationContext(
  messages: Array<{ role: string; content: string }>,
  maxChars = DEFAULT_MAX_CONTEXT_CHARS,
) {
  const selected: Array<{ role: string; content: string }> = [];
  let total = 0;

  for (const message of [...messages].reverse()) {
    const cost = message.content.length + message.role.length + 20;

    if (total + cost > maxChars) break;

    selected.unshift(message);
    total += cost;
  }

  return {
    messages: selected,
    usedChars: total,
    truncated: selected.length < messages.length,
  };
}
