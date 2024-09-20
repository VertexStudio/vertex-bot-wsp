export function buildPromptMessages(
  systemPrompt: string,
  relevantFactsText: string,
  formattedMessages: { role: string; content: string }[],
  userName: string,
  body: string
): { role: string; content: string }[] {
  const systemMessage = {
    role: "system",
    content: `${systemPrompt}\n\nRelevant facts (your RAG info):\n\n${relevantFactsText}`,
  };

  const userMessage = { role: "user", content: `${userName}: ${body}` };

  return [systemMessage, ...formattedMessages, userMessage];
}
