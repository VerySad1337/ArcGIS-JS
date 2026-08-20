// Every operator-facing knob for this service lives here, read once at
// startup, so nothing downstream reaches into process.env directly and no
// module hardcodes a model name, host, or port. Same "fail loud on missing
// config" convention onemap-proxy/server.js uses for ONEMAP_EMAIL/PASSWORD -
// a misconfigured deployment should refuse to start, not silently 500 (or
// silently call the wrong model) on the first real request.
const REQUIRED = ["OLLAMA_URL", "OLLAMA_MODEL", "ARCGIS_PORTAL_URL"];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[mcp-chat-proxy] Missing required env var(s): ${missing.join(", ")} - refusing to start. See README.md's configuration table.`
  );
  process.exit(1);
}

function numberEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function booleanEnv(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

// undefined (not "all") means "no restriction" - every tool in
// toolSchemas.js's ALL_TOOLS is offered to the model. Set to disable
// specific tools (e.g. every mutating action) without a code change.
const enabledToolsRaw = process.env.CHAT_ENABLED_TOOLS;
const enabledTools = enabledToolsRaw
  ? new Set(enabledToolsRaw.split(",").map((s) => s.trim()).filter(Boolean))
  : null;

module.exports = {
  ollamaUrl: process.env.OLLAMA_URL.replace(/\/+$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL,
  ollamaTemperature: numberEnv("OLLAMA_TEMPERATURE", 0.2),
  ollamaNumCtx: numberEnv("OLLAMA_NUM_CTX", 8192),
  // Measured directly against this app's real payload (12 tool schemas +
  // system prompt, ~1560 tokens) on CPU-only Ollama: prompt evaluation
  // alone took ~206s, ~220s total for one turn - slow prompt processing,
  // not generation, dominates on CPU. 60s (and even 150s) was nowhere
  // close. 300s gives real headroom above that measurement. Kept
  // comfortably under nginx.conf's /api/chat/ proxy_read_timeout (340s)
  // so this fires first with a clear error rather than nginx cutting the
  // connection.
  ollamaRequestTimeoutMs: numberEnv("OLLAMA_REQUEST_TIMEOUT_MS", 300_000),
  // Ollama keeps a model resident in RAM after answering (its own default
  // is 5 minutes of idle) so the next request skips the load. Between
  // chats that residency is the single largest thing this feature costs a
  // small instance - the weights plus the KV cache sized by OLLAMA_NUM_CTX
  // sit there holding ~1-1.5GB hostage while nobody is talking to it.
  // Passed through on every request, which overrides whatever
  // OLLAMA_KEEP_ALIVE the Ollama server itself was started with. "0"
  // unloads immediately after each call, "30s"/"5m" after that much idle.
  // null = send nothing and inherit Ollama's own default, i.e. exactly the
  // behaviour before this option existed.
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || null,
  // The targeted version of the same idea, and the one to prefer: rather
  // than waiting out an idle timer, evict the model the moment a turn is
  // genuinely finished (see chatLoop.js's releaseModelAfterTurn, which
  // knows the difference between "the model has answered the user" and
  // "the browser is about to come straight back with a tool result"). A
  // blunt OLLAMA_KEEP_ALIVE=0 cannot make that distinction, and would pay
  // a full model reload in the middle of a single user request.
  ollamaUnloadAfterTurn: booleanEnv("OLLAMA_UNLOAD_AFTER_TURN", false),
  arcgisPortalUrl: process.env.ARCGIS_PORTAL_URL.replace(/\/+$/, ""),
  port: numberEnv("CHAT_PROXY_PORT", 4001),
  // null = every tool enabled; otherwise the allow-listed subset.
  enabledTools,
  isToolEnabled(name) {
    return enabledTools === null || enabledTools.has(name);
  },
  // How many server-tool round trips a single user message may trigger
  // before the loop gives up and returns whatever text it has - guards
  // against a model stuck in a call/call/call loop from ever hanging a
  // request indefinitely. Not exposed as an env var deliberately: it's an
  // abuse/runaway guard, not an operator preference.
  maxServerToolHops: 6
};
