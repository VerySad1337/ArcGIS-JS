// Talks to mcp-chat-proxy's chat endpoints, same-origin via nginx.conf's
// /api/chat/ reverse-proxy rule (no CORS, no env var - identical reasoning
// to GeocodingService.js's onemap-proxy calls). See
// knowledge/features/chatbot-mcp-system.md for the full protocol these two
// calls implement: sendChatMessage starts/continues a turn; whenever its
// reply comes back as a pendingAction instead of text, the caller executes
// that action locally (see ApplicationShell.jsx's chatActionExecutor) and
// reports the outcome via sendToolResult to resume the same conversation.
//
// This service is deliberately stateless, mirroring mcp-chat-proxy itself:
// it never holds the message list - the caller (ChatPanel.jsx) owns and
// passes the full array every time.
async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.error || "The chat assistant is currently unavailable.");
  }

  return response.json();
}

export async function sendChatMessage(messages, mapContext) {
  return postJson("/api/chat/message", { messages, mapContext });
}

export async function sendToolResult(messages, mapContext, callId, result) {
  return postJson("/api/chat/tool-result", { messages, mapContext, callId, result });
}
