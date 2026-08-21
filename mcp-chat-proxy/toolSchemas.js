// Single source of truth for every tool the model is offered, in Ollama's
// tool-calling shape (https://ollama.com/blog/tool-support - same
// `{type:"function", function:{name, description, parameters}}` shape
// OpenAI-compatible tool calling uses). `domain` is this file's own
// addition, not part of what's sent to Ollama - chatLoop.js reads it to
// decide whether a call executes here (server) or gets handed back to the
// browser (client). See knowledge/features/chatbot-mcp-system.md.
//
// "server" tools are also registered as real MCP tools in mcpServer.js -
// their name/description/parameters here and their zod input schema there
// describe the same tool and must be kept in sync by hand (two different
// schema languages - JSON Schema for Ollama, zod for the MCP SDK - so they
// can't share one definition without a schema-conversion dependency this
// service doesn't otherwise need for only three tools).
//
// "client" tools have no server-side handler at all: GISMapEngine (see
// knowledge/architecture.md) lives only in the browser, so these exist
// purely as schemas the model can call - chatLoop.js returns them to the
// frontend as a pendingAction instead of executing anything.

const SERVER_TOOLS = [
  {
    domain: "server",
    type: "function",
    function: {
      name: "search_portal_layers",
      description:
        "Search the configured ArcGIS Portal for Feature Service items the user could add as a map layer. Mirrors the app's own portal search (PortalService.js).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text portal search query." }
        },
        required: ["query"]
      }
    }
  },
  {
    domain: "server",
    type: "function",
    function: {
      name: "query_layer_features",
      description:
        "Query features from a hosted/portal feature layer that is CURRENTLY on the user's map (url must be one of the layer URLs supplied in the request's map context - arbitrary URLs are rejected).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The feature layer's URL, exactly as it appears in the current map's layer list." },
          where: { type: "string", description: "SQL-style where clause. Defaults to \"1=1\" (all features) if omitted." },
          outFields: {
            type: "array",
            items: { type: "string" },
            description: "Field names to return. Defaults to all fields if omitted."
          },
          resultRecordCount: { type: "integer", description: "Max features to return. Defaults to 50, capped at 500." }
        },
        required: ["url"]
      }
    }
  },
  {
    domain: "server",
    type: "function",
    function: {
      name: "get_layer_statistics",
      description:
        "Compute a statistic (count/sum/avg/min/max/stddev) over one field of a feature layer that is CURRENTLY on the user's map (same url restriction as query_layer_features).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The feature layer's URL, exactly as it appears in the current map's layer list." },
          field: { type: "string", description: "Field to aggregate." },
          statisticType: {
            type: "string",
            enum: ["count", "sum", "avg", "min", "max", "stddev", "var"],
            description: "Statistic to compute."
          },
          where: { type: "string", description: "Optional SQL-style where clause to restrict which features are included." }
        },
        required: ["url", "field", "statisticType"]
      }
    }
  }
];

const CLIENT_TOOLS = [
  {
    domain: "client",
    type: "function",
    function: {
      name: "create_heatmap_layer",
      description:
        "Create a new named heatmap layer on the map from a point-geometry source layer that is currently in the layer list (GISMapEngine.createHeatmapLayer).",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "id of an existing, heatmap-eligible layer (see the map context's layer list)." },
          name: { type: "string", description: "Name for the new layer." },
          intensity: { type: "number", description: "0-100, defaults to 50." }
        },
        required: ["sourceId", "name"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "create_hexagon_layer",
      description:
        "Bin a point/polygon/line source layer into a hexagon grid and add it as a new named layer (GISMapEngine.createHexagonLayer).",
      parameters: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "id of an existing, hexagon-eligible layer." },
          name: { type: "string", description: "Name for the new layer." },
          cellSize: { type: "number", description: "Hexagon flat-to-flat width in meters, defaults to 500." }
        },
        required: ["sourceId", "name"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "select_feature",
      description:
        "Select a single map feature by describing it in words, exactly as clicking it on the map would (GISMapEngine.searchFeatures + zoomToSearchResult). Searches every string field of every searchable layer - Tourist Attractions, MRT Stations, MRT Lines, Drawings and any portal layer - zooms to the best match, opens its attribute popup, and makes it the selected feature. This is the ONLY way to establish a selection without the user clicking the map themselves, so call it first whenever the user names a feature and asks for something that acts on a selection (apply_buffer above all). The result reports the feature actually selected and any other close matches, so say which one you acted on.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text to match against the feature's attribute values, e.g. \"Tampines\" or \"Marina Bay Sands\". Use the words the user used; do not guess a field name - every string field is searched."
          },
          layerId: {
            type: "string",
            description: "Optional. Restrict the search to one layer id from the map context's layer list. Omit to search every searchable layer."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "get_layer_aggregate",
      description:
        "Count features on a layer already on the map, and optionally compute sum/avg/min/max over one numeric field (GISMapEngine.getLayerAggregate). Unlike get_layer_statistics, this runs in the browser and honours the layer's ACTIVE FILTER, so it answers \"how many are showing now\" rather than \"how many exist in the service\" - use it after set_layer_filter, and for the local Drawings layer, which has no service URL to query. Field names must come from that layer's own `fields` list in the map context.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Layer id from the map context's layer list." },
          field: { type: "string", description: "Optional numeric field to aggregate. Omit for a plain feature count." },
          statistics: {
            type: "array",
            items: { type: "string", enum: ["sum", "avg", "min", "max"] },
            description: "Which statistics to compute over `field`. Ignored when no field is given."
          }
        },
        required: ["id"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "apply_buffer",
      description:
        "Buffer the currently-selected map feature by a distance (GISMapEngine.bufferSelectedFeature). Requires a feature to be selected first - if the user named one rather than clicking it themselves, call select_feature before this.",
      parameters: {
        type: "object",
        properties: {
          distance: { type: "number", description: "Buffer distance." },
          unit: { type: "string", enum: ["meters", "kilometers", "feet", "miles"], description: "Defaults to meters." }
        },
        required: ["distance"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "create_buffer_result_layer",
      description: "Save the current buffer result as a new named, permanent layer (GISMapEngine.createBufferResultLayer). Requires a buffer to already exist (call apply_buffer first).",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name for the new layer." } },
        required: ["name"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "calculate_route",
      description:
        "Calculate and draw a route between two addresses (GeocodingService.geocodeAddress + RoutingService.solveRoute + GISMapEngine.drawRoute/drawStops) - the same flow the app's own Route Search form uses. Geocodes both addresses via OneMap, then draws the route line plus its start (green circle) and end (red square) stop markers on the map. Both addresses are geocoded independently, so a locally-known place name, a full street address, or a 6-digit postal code all work, exactly as typed by the user - never ask the user which format they mean or to restate it. If the user's message already names both a start and an end (e.g. \"520897 to ICA Service centre\"), call this right away with those two values; do not ask a clarifying question first.",
      parameters: {
        type: "object",
        properties: {
          startAddress: { type: "string", description: "Starting address, building/place name, or 6-digit postal code, exactly as the user wrote it." },
          endAddress: { type: "string", description: "Destination address, building/place name, or 6-digit postal code, exactly as the user wrote it." }
        },
        required: ["startAddress", "endAddress"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "create_route_result_layer",
      description: "Save the current route search result (route line plus its two stop markers) as a new named, permanent layer (GISMapEngine.createRouteResultLayer). Requires a route to already exist (call calculate_route first).",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Name for the new layer." } },
        required: ["name"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "add_portal_layer",
      description:
        "Add a portal Feature Service layer to the map by name (GISMapEngine.addPortalLayer). item.title is matched against real portal search results server-side - prefer using the exact title from a prior search_portal_layers call, but a close/approximate title is resolved automatically too. Any id/url you supply are ignored; only the title is used to find the layer. The layer is added under its own real portal title. If the user wants it displayed under a DIFFERENT custom name, do NOT try to pass that here - call add_portal_layer first, read the new layer's id back from this call's result, then call rename_layer with that id and the requested name as a separate, second tool call.",
      parameters: {
        type: "object",
        properties: {
          item: {
            type: "object",
            description: "Ideally an item object exactly as returned by search_portal_layers; at minimum needs a title.",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              url: { type: "string" }
            },
            required: ["title"]
          }
        },
        required: ["item"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "rename_layer",
      description:
        "Rename an existing layer (GISMapEngine.renameLayer). Use this - as a separate call from add_portal_layer/create_heatmap_layer/etc. - whenever the user wants a layer displayed under a specific name different from whatever it was created/found as.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Layer id - e.g. the id returned in a prior add_portal_layer/create_heatmap_layer/... result." },
          name: { type: "string", description: "The new display name." }
        },
        required: ["id", "name"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "set_layer_filter",
      description:
        "Apply a filter to a layer (GISMapEngine.setLayerFilter). One or more conditions, combined by `logic`; omitting `conditions` entirely clears the layer's filter. Every `field` must be copied exactly from that layer's own `fields` array in the map state - a guessed or translated field name fails.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Layer id from the map context's layer list." },
          logic: { type: "string", enum: ["AND", "OR"], description: "Defaults to AND." },
          conditions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                // These are LayerFilterExpression.js's FILTER_OPERATORS keys
                // verbatim. They previously were not: this enum advertised
                // "!=", "is null" and "is not null", none of which exist in
                // that table, so a model picking the obvious "!=" for "filter
                // OUT x" got '"!=" is not a supported filter operator.'
                // ApplicationShell.runClientAction also maps those three
                // spellings onto the real tokens, since a model will keep
                // producing them regardless of what this enum says.
                operator: {
                  type: "string",
                  enum: [
                    "=",
                    "<>",
                    ">",
                    ">=",
                    "<",
                    "<=",
                    "contains",
                    "doesNotContain",
                    "startsWith",
                    "endsWith",
                    "isNull",
                    "isNotNull"
                  ],
                  description:
                    "Text: use `contains` to keep only the features whose value mentions the term, and `doesNotContain` to exclude them - prefer these over =/<>, which compare the WHOLE value and so miss \"Tampines\" inside \"TAMPINES MRT STATION\". \"Filter out X\", \"filter for X\", \"show only X\" all mean keep only X (`contains`); use `doesNotContain` only when the user says exclude/remove/hide/except. isNull/isNotNull take no value."
                },
                value: { description: "Comparison value; omit for isNull/isNotNull." }
              },
              required: ["field", "operator"]
            }
          }
        },
        required: ["id", "conditions"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "set_layer_style",
      description: "Change a layer's color/border/opacity (GISMapEngine.setLayerStyle).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Layer id from the map context's layer list." },
          color: { type: "string", description: "CSS color, e.g. #ff0000." },
          borderWidth: { type: "number" },
          opacity: { type: "number", description: "0-1." }
        },
        required: ["id"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "toggle_layer",
      description: "Show/hide a layer (GISMapEngine.toggleLayer).",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Layer id from the map context's layer list." } },
        required: ["id"]
      }
    }
  },
  {
    domain: "client",
    type: "function",
    function: {
      name: "zoom_to_layer",
      description: "Pan/zoom the map to a layer's extent (GISMapEngine.zoomToLayer).",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "Layer id from the map context's layer list." } },
        required: ["id"]
      }
    }
  }
];

const ALL_TOOLS = [...SERVER_TOOLS, ...CLIENT_TOOLS];
const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.function.name));
const SERVER_TOOL_NAMES = new Set(SERVER_TOOLS.map((t) => t.function.name));

module.exports = { ALL_TOOLS, CLIENT_TOOL_NAMES, SERVER_TOOL_NAMES };
