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
