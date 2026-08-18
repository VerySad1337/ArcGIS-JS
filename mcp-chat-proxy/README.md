# mcp-chat-proxy

Local-model chatbot backend for the ArcGIS JS app. Runs a real [MCP](https://modelcontextprotocol.io) server exposing ArcGIS Portal search / feature-query / statistics tools, and brokers map-mutating "client" tools back to the browser (see `knowledge/features/chatbot-mcp-system.md` in the repo root for the full design and why the split exists — the map only lives in the browser's `GISMapEngine`, this service has no access to it).

Nothing about the model, host, port, portal, or tool set is hardcoded — everything is env-driven. This service **fails loud at startup** if a required var is missing, rather than starting and 500ing on the first request.

## Required configuration

| Var | Purpose |
|---|---|
| `OLLAMA_URL` | Base URL of an Ollama-compatible server, e.g. `http://ollama:11434` or `http://localhost:11434` if you already run Ollama yourself. |
| `OLLAMA_MODEL` | Model tag to chat with. Must support tool calling — e.g. `qwen2.5:7b-instruct`, `llama3.1:8b`, `mistral-nemo`. No default is assumed; pick whichever fits your hardware. |
| `ARCGIS_PORTAL_URL` | The ArcGIS Portal the `search_portal_layers` tool searches — reuse the same value as the frontend's `VITE_ARCGIS_PORTAL_URL`. |

## Optional configuration

| Var | Default | Purpose |
|---|---|---|
| `OLLAMA_TEMPERATURE` | `0.2` | Generation temperature. |
| `OLLAMA_NUM_CTX` | `8192` | Context window size passed to Ollama. |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | Abort a stuck Ollama request after this long. 300s (5min) by default — measured directly against this app's real tool-schema payload on CPU-only Ollama: one turn can legitimately take ~220s, dominated by prompt evaluation, not generation. Kept under `nginx.conf`'s `/api/chat/` `proxy_read_timeout` (340s) so this fires first with a clear error. |
| `CHAT_PROXY_PORT` | `4001` | Listen port. |
| `CHAT_ENABLED_TOOLS` | (all tools) | Comma-separated allow-list of tool names (see `toolSchemas.js`) actually offered to the model. Set this to lock a deployment to read-only tools, e.g. `search_portal_layers,query_layer_features,get_layer_statistics` with no map-mutating tools at all. |

## Running Ollama

Bring your own, or use the optional `ollama` service in the repo root's `docker-compose.yml`:

```
docker compose up --build
```

`mcp-chat-proxy` pulls `OLLAMA_MODEL` itself on startup if Ollama doesn't already have it (`ollamaClient.js`'s `ensureModelAvailable`) — watch `docker compose logs -f mcp-chat-proxy` for progress on a fresh deployment (a multi-GB model can take a while). This runs in the background after the server starts listening, so `/healthz` responds immediately either way. If you'd rather pre-warm it (or the auto-pull failed — check the logs for the reason), run it manually:

```
docker compose exec ollama ollama pull <model you set OLLAMA_MODEL to>
```

If you already run Ollama elsewhere (host machine, another server), just point `OLLAMA_URL` at it and remove/scale the `ollama` service to zero — it isn't load-bearing infrastructure, it's a convenience default. `ensureModelAvailable` works the same way against any reachable Ollama instance.

## Available tools

The full menu of tools the model can call, defined in `toolSchemas.js`. All are enabled by default; restrict which ones are actually offered with `CHAT_ENABLED_TOOLS` above (e.g. set it to just the three server tools below for a read-only deployment).

**Server-executed** — the sidecar runs these itself via real ArcGIS REST calls, no browser/map access needed. Also exposed as genuine MCP tools at `POST /mcp` for any external MCP client.

| Tool | What it does |
|---|---|
| `search_portal_layers` | Searches the configured ArcGIS Portal (`ARCGIS_PORTAL_URL`) for Feature Service layers. |
| `query_layer_features` | Pulls feature attributes from a layer already on the user's map (rejected if the URL isn't one of the map's current layers, or resolves to a private/loopback address — see Security notes). |
| `get_layer_statistics` | Computes count/sum/avg/min/max/stddev/var over one field of a layer already on the user's map. |

**Client-executed** — no server-side handler; the sidecar hands these back to the browser as a `pendingAction`, and `ApplicationShell.jsx`'s `runClientAction` runs them through the exact same `GISMapEngine`/service methods the manual UI buttons call.

| Tool | What it does |
|---|---|
| `create_heatmap_layer` | Adds a new heatmap layer from a point-geometry source layer. |
| `create_hexagon_layer` | Bins a point/polygon/line source layer into a hexagon grid. |
| `apply_buffer` | Buffers the feature currently selected on the map. |
| `create_buffer_result_layer` | Saves the current buffer result as a permanent named layer. |
| `add_portal_layer` | Finds and adds a portal layer by title (fuzzy-matched server-side against real search results — see `chatLoop.js`'s `resolveAddPortalLayerItem`), under its own real portal title. |
| `rename_layer` | Renames an existing layer — a separate call from `add_portal_layer`/`create_heatmap_layer`/etc. on purpose, see the note below. |
| `set_layer_filter` | Applies a where-style filter (one or more conditions, AND/OR) to a layer. |
| `set_layer_style` | Changes a layer's color/border width/opacity. |
| `toggle_layer` | Shows/hides a layer. |
| `zoom_to_layer` | Pans/zooms the map to a layer's extent. |

A user asking to "add X and call it Y" is fulfilled as **two** tool calls (`add_portal_layer` then `rename_layer`), not one call with both a lookup title and a display name. A single call carrying multiple fields turned out to be unreliable for small local models — observed directly, `qwen2.5:1.5b` dropped an optional `name` field on `add_portal_layer` even after it was marked `required`. Splitting into simple, sequential, single-purpose calls (mirroring the already-working `apply_buffer` → `create_buffer_result_layer` chain) fixed it. `chatLoop.js` logs every tool call's name and arguments to stdout, which is what made this diagnosable in the first place.

## Endpoints

- `GET /healthz`
- `POST /mcp` — the MCP server itself (Streamable HTTP transport, stateless). Point any MCP client at `http://<host>:4001/mcp`.
- `POST /api/chat/message` — `{ messages, mapContext }` → `{ reply, pendingAction, messages }`. See `chatLoop.js`.
- `POST /api/chat/tool-result` — `{ messages, mapContext, callId, result }` → same shape, resumes a paused client-tool turn.

## Security notes

- `query_layer_features`/`get_layer_statistics` reject any `url` that isn't already one of the current map's layer URLs (`mapContext.queryableLayerUrls`, sent by the frontend every request) **and** reject anything resolving to a loopback/private/link-local address regardless of context (`urlSafety.js`) — the latter guard also protects the standalone `/mcp` endpoint, which has no map context to check against.
- `add_portal_layer` never trusts a model-supplied id/url: only `item.title` is used, resolved server-side against real portal search results (first against searches already run this conversation, then a fresh search if needed) — there's no path for it to add an arbitrary/fictional URL. See `chatLoop.js`'s `resolveAddPortalLayerItem`.
- Map-mutating tools reuse the exact same `GISMapEngine`/`ApplicationShell` handlers the manual UI buttons call, so they inherit the app's existing anonymous-first authorization checks (`IdentityManager`/`canEdit`) — the chat feature cannot do anything the signed-in-or-not user couldn't already do by clicking through the UI.
