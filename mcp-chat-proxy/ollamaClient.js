// Thin wrapper over Ollama's native /api/chat (tool-calling capable - see
// https://ollama.com/blog/tool-support). Every knob here comes from
// config.js, which itself comes entirely from env vars - no model name,
// host, or generation parameter is hardcoded in this file.
const config = require("./config");

async function chat(messages, tools) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ollamaRequestTimeoutMs);

  try {
    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollamaModel,
        messages,
        tools,
        stream: false,
        options: {
          temperature: config.ollamaTemperature,
          num_ctx: config.ollamaNumCtx
        }
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama request failed (${response.status}): ${text || response.statusText}`);
    }

    const body = await response.json();
    return body.message; // { role: "assistant", content, tool_calls? }
  } finally {
    clearTimeout(timeout);
  }
}

// Ollama doesn't fetch a model on its own the first time it's referenced -
// it 404s with "model '<name>' not found" until something explicitly pulls
// it (this was a real deploy-time failure: mcp-chat-proxy started fine,
// but nothing had ever run `ollama pull` for OLLAMA_MODEL, so every chat
// request 404'd). This makes the configured model self-serve on startup
// instead of requiring that manual step - still just calling Ollama's own
// /api/pull, so it works for any model name, no code change needed to
// change models.
async function listInstalledModels() {
  const response = await fetch(`${config.ollamaUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Could not reach Ollama at ${config.ollamaUrl} to list models (${response.status})`);
  }
  const body = await response.json();
  return (body.models || []).map((m) => m.name || m.model);
}

// Ollama's own tag matching is lenient about an implicit ":latest" suffix -
// mirror that here so OLLAMA_MODEL=qwen2.5 matches an installed
// "qwen2.5:latest" without forcing the operator to spell out the tag.
function modelNamesMatch(installed, wanted) {
  const normalize = (name) => (name.includes(":") ? name : `${name}:latest`);
  return normalize(installed) === normalize(wanted);
}

async function pullModel(onProgress) {
  const response = await fetch(`${config.ollamaUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.ollamaModel, stream: true })
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Failed to pull model "${config.ollamaModel}": ${response.status} ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.error) throw new Error(`Failed to pull model "${config.ollamaModel}": ${event.error}`);
      onProgress?.(event);
    }
  }
}

// Waits for Ollama to answer /api/tags before attempting anything else -
// `depends_on` in docker-compose.yml only orders container *start*, not
// "Ollama has finished initializing", so mcp-chat-proxy can otherwise win
// the race and see connection-refused on its very first request.
async function waitForOllama({ retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await listInstalledModels();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Best-effort, called once at startup (see server.js) - logs progress so
// `docker logs mcp-chat-proxy` shows exactly what's happening during a
// multi-GB download instead of sitting silently. Never throws past its own
// caller's try/catch: a failure here just means chat requests will keep
// 404ing with a clear "model not found" error until it's resolved (e.g.
// manually running `ollama pull`), same as before this existed.
async function ensureModelAvailable() {
  await waitForOllama();

  const installed = await listInstalledModels();
  if (installed.some((name) => modelNamesMatch(name, config.ollamaModel))) {
    console.log(`[mcp-chat-proxy] Model "${config.ollamaModel}" is already installed.`);
    return;
  }

  console.log(`[mcp-chat-proxy] Model "${config.ollamaModel}" not found on ${config.ollamaUrl} - pulling now (this can take a while for larger models)...`);
  let lastLoggedPercent = -1;
  await pullModel((event) => {
    if (event.total && event.completed) {
      const percent = Math.floor((event.completed / event.total) * 100);
      if (percent !== lastLoggedPercent && percent % 10 === 0) {
        console.log(`[mcp-chat-proxy] Pulling "${config.ollamaModel}": ${percent}%`);
        lastLoggedPercent = percent;
      }
    } else if (event.status) {
      console.log(`[mcp-chat-proxy] Pulling "${config.ollamaModel}": ${event.status}`);
    }
  });
  console.log(`[mcp-chat-proxy] Model "${config.ollamaModel}" ready.`);
}

module.exports = { chat, ensureModelAvailable };
