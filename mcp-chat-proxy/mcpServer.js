// The real MCP server: registers the three server-executed tools
// (portalTools.js) over the Model Context Protocol so any MCP client -
// this service's own in-process chat loop (see mcpClient.js), or an
// external one like Claude Desktop pointed at this container's /mcp
// endpoint (see server.js) - can call them the same way. Deliberately only
// the read-only, server-executable tools live here: everything that
// mutates the live map is a "client" tool in toolSchemas.js with no
// handler at all, since GISMapEngine only exists in the browser (see
// knowledge/features/chatbot-mcp-system.md).
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const portalTools = require("./portalTools");

const mcpServer = new McpServer({ name: "mcp-chat-proxy", version: "1.0.0" });

function asToolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

mcpServer.registerTool(
  "search_portal_layers",
  {
    description: "Search the configured ArcGIS Portal for Feature Service items.",
    inputSchema: { query: z.string() }
  },
  async ({ query }) => asToolResult(await portalTools.searchPortalLayers({ query }))
);

mcpServer.registerTool(
  "query_layer_features",
  {
    description: "Query features (attributes only) from a hosted/portal feature layer URL.",
    inputSchema: {
      url: z.string().url(),
      where: z.string().optional(),
      outFields: z.array(z.string()).optional(),
      resultRecordCount: z.number().int().positive().optional()
    }
  },
  async (args) => asToolResult(await portalTools.queryLayerFeatures(args))
);

mcpServer.registerTool(
  "get_layer_statistics",
  {
    description: "Compute a statistic over one field of a feature layer URL.",
    inputSchema: {
      url: z.string().url(),
      field: z.string(),
      statisticType: z.enum(["count", "sum", "avg", "min", "max", "stddev", "var"]),
      where: z.string().optional()
    }
  },
  async (args) => asToolResult(await portalTools.getLayerStatistics(args))
);

module.exports = { mcpServer };
