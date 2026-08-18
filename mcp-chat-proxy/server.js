// Local-model chatbot backend - see README.md for the full protocol and
// knowledge/features/chatbot-mcp-system.md for the architectural writeup.
// Two things live in this one small service:
//   1. A real MCP server (mcpServer.js) exposing the read-only, ArcGIS
//      Portal/feature-layer tools at POST /mcp, for any MCP client.
//   2. The app's own chat endpoints (/api/chat, /api/chat/tool-result),
//      which run chatLoop.js - the same server-tool implementations called
//      in-process, plus the client-tool handoff protocol the browser needs
//      for anything that mutates the live map.
require("./config"); // validates required env vars first, fails loud if missing
const express = require("express");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { mcpServer } = require("./mcpServer");
const chatLoop = require("./chatLoop");
const ollamaClient = require("./ollamaClient");
const config = require("./config");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// Stateless MCP endpoint: a fresh transport per request, no session
// persisted server-side (the resulting protocol is a plain request/reply,
// no server-initiated push a stateless client would need). Mirrors the
// SDK's documented stateless Streamable HTTP pattern.
app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp-chat-proxy] /mcp request failed:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
});

// Body: { messages: ChatMessage[], mapContext: { is3D, layers, queryableLayerUrls } }
// Reply: { reply: string, pendingAction: null, messages } once the model has
// a final text answer, or { reply: null, pendingAction: {...}, messages }
// when it wants to invoke a client (map-mutating) tool - see
// ChatPanel.jsx for how the frontend fulfills a pendingAction and calls
// /api/chat/tool-result to resume.
app.post("/api/chat/message", async (req, res) => {
  const { messages, mapContext } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages must be a non-empty array" });
    return;
  }

  try {
    const result = await chatLoop.startChat(messages, mapContext || {});
    res.status(200).json(result);
  } catch (err) {
    console.error("[mcp-chat-proxy] /api/chat/message failed:", err.message);
    res.status(502).json({ error: "The chat model is currently unavailable." });
  }
});

// Body: { messages, mapContext, callId, result } - result is whatever the
// browser's engine call actually returned/threw, so the model's next reply
// reflects the real outcome rather than the request it made.
app.post("/api/chat/tool-result", async (req, res) => {
  const { messages, mapContext, callId, result } = req.body || {};
  if (!Array.isArray(messages) || typeof callId !== "string") {
    res.status(400).json({ error: "messages (array) and callId (string) are required" });
    return;
  }

  try {
    const loopResult = await chatLoop.submitToolResult(messages, mapContext || {}, callId, result ?? null);
    res.status(200).json(loopResult);
  } catch (err) {
    console.error("[mcp-chat-proxy] /api/chat/tool-result failed:", err.message);
    res.status(502).json({ error: "The chat model is currently unavailable." });
  }
});

app.listen(config.port, () => {
  console.log(`[mcp-chat-proxy] Listening on port ${config.port} (model=${config.ollamaModel}, ollama=${config.ollamaUrl})`);

  // Fire-and-forget: pulls OLLAMA_MODEL if Ollama doesn't already have it,
  // so a fresh deployment doesn't require a separate manual
  // `ollama pull <model>` step before the first chat message works. Runs
  // after listen() (not before) so /healthz responds immediately even
  // while a large model is still downloading, rather than the whole
  // service appearing down during that window. A failure here just means
  // chat requests keep failing with a clear "model not found"/connection
  // error, same as if this didn't exist - see ollamaClient.js.
  ollamaClient.ensureModelAvailable().catch((err) => {
    console.error(`[mcp-chat-proxy] Could not ensure model "${config.ollamaModel}" is available:`, err.message);
    console.error(`[mcp-chat-proxy] Pull it manually, e.g.: docker compose exec ollama ollama pull ${config.ollamaModel}`);
  });
});
