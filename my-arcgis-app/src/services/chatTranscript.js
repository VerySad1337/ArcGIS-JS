// Bounding the retained chat transcript.
//
// `protocolMessages` in ChatPanel is the literal array mcp-chat-proxy
// round-trips, and nothing ever shrinks it: every tool result the model has
// seen this session stays in it - whole search_portal_layers payloads,
// feature-query JSON, statistics results. That is browser memory held for a
// tab that may be open all day, and because the service is stateless by
// design the whole array is re-uploaded on every single request (see
// knowledge/features/chatbot-mcp-system.md).
//
// This lives beside ChatService.js because it encodes the same wire-protocol
// knowledge - specifically how an assistant `tool_calls` entry pairs with the
// `tool` message answering it. It is a pure function over an array and makes
// no network or engine call, so importing it does not give ChatPanel the
// service dependency that component deliberately avoids.
const MAX_TRANSCRIPT_CHARS = 128 * 1024;

function transcriptSize(messages) {
  return JSON.stringify(messages).length;
}

// Indices where a new user turn begins - the only points in the transcript
// guaranteed not to fall between an assistant `tool_calls` entry and the
// `tool` message answering it under its `tool_call_id`. mcp-chat-proxy pairs
// exactly those two when it walks this array (knownPortalItems,
// renameOwedAfterAdd), so a cut anywhere else would silently break
// portal-item resolution and the deterministic post-add rename.
function userTurnStarts(messages) {
  const starts = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role === "user") starts.push(i);
  }
  return starts;
}

// Drops whole oldest exchanges until the transcript is back under budget.
//
// Call this only at the start of a NEW user turn, never mid-chain: a turn in
// flight still owes a tool result under a specific callId, and trimming
// underneath it would strand that pairing.
//
// Two things are never dropped: a leading system message (the server replaces
// it via withSystemMessage regardless, but keeping it preserves what index 0
// means), and the most recent exchange, however large - a transcript trimmed
// to nothing would discard the context of the conversation the user is
// actually having. Returns the original array untouched when it already fits,
// so the common case allocates nothing.
export function trimTranscript(messages, maxChars = MAX_TRANSCRIPT_CHARS) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  if (transcriptSize(messages) <= maxChars) return messages;

  const hasSystem = messages[0].role === "system";
  const system = hasSystem ? messages.slice(0, 1) : [];
  let body = messages.slice(hasSystem ? 1 : 0);

  let starts = userTurnStarts(body);
  while (starts.length > 1 && transcriptSize([...system, ...body]) > maxChars) {
    body = body.slice(starts[1]);
    starts = userTurnStarts(body);
  }

  return [...system, ...body];
}
