import { trimTranscript } from "./chatTranscript";

// --- Retained-transcript cap ------------------------------------------------
// protocolMessages grows for the whole session and is re-uploaded on every
// request. Trimming it is only safe on user-turn boundaries: mcp-chat-proxy
// pairs an assistant tool_call with the tool message answering it by
// tool_call_id, so a cut between those two breaks portal-item resolution and
// the deterministic post-add rename.
describe("trimTranscript", () => {
  const bulky = (n) => "x".repeat(n);

  // One complete exchange: user asks, model calls a tool, tool answers,
  // model replies. The tool result is what makes real transcripts big.
  const exchange = (n, payloadChars) => [
    { role: "user", content: `question ${n}` },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: `call_${n}`, type: "function", function: { name: "search_portal_layers", arguments: {} } }]
    },
    { role: "tool", tool_call_id: `call_${n}`, content: JSON.stringify({ items: bulky(payloadChars) }) },
    { role: "assistant", content: `answer ${n}` }
  ];

  test("leaves a transcript that already fits completely untouched", () => {
    const messages = [{ role: "system", content: "sys" }, ...exchange(1, 10)];
    expect(trimTranscript(messages)).toBe(messages);
  });

  test("drops whole oldest exchanges, never splitting a tool call from its result", () => {
    const messages = [
      { role: "system", content: "sys" },
      ...exchange(1, 4000),
      ...exchange(2, 4000),
      ...exchange(3, 4000)
    ];

    const trimmed = trimTranscript(messages, 10 * 1024);

    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed[0].role).toBe("system");

    // Every tool result still has the assistant tool_call that produced it.
    const callIds = new Set(
      trimmed.flatMap((m) => (m.tool_calls || []).map((c) => c.id))
    );
    for (const message of trimmed) {
      if (message.role === "tool") expect(callIds.has(message.tool_call_id)).toBe(true);
    }

    // The newest exchange survives; the oldest is the one that went.
    expect(trimmed.some((m) => m.content === "question 3")).toBe(true);
    expect(trimmed.some((m) => m.content === "question 1")).toBe(false);
  });

  test("keeps the most recent exchange even when it alone exceeds the cap", () => {
    const messages = exchange(1, 50_000);
    const trimmed = trimTranscript(messages, 1024);

    expect(trimmed.some((m) => m.content === "question 1")).toBe(true);
    expect(trimmed.filter((m) => m.role === "tool")).toHaveLength(1);
  });

  test("trims correctly when there is no leading system message", () => {
    const messages = [...exchange(1, 4000), ...exchange(2, 4000)];
    const trimmed = trimTranscript(messages, 5 * 1024);

    expect(trimmed[0].role).toBe("user");
    expect(trimmed.some((m) => m.content === "question 2")).toBe(true);
  });
});
