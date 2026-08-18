// Plain async implementations of the three server-executed tools, shared
// by mcpServer.js (which wraps them as real MCP tools for external
// clients) and chatLoop.js (which calls them directly, in-process, for the
// in-app chat - no reason to round-trip through HTTP/MCP transport for a
// call this same process is already handling). Talks to ArcGIS REST
// directly (no @arcgis/core dependency needed server-side) - mirrors the
// query shapes my-arcgis-app/src/services/PortalService.js already uses
// client-side, just executed here instead.
const { Agent } = require("undici");
const config = require("./config");
const { resolveSafeAddress } = require("./urlSafety");

const MAX_RECORD_COUNT = 500;
const DEFAULT_RECORD_COUNT = 50;

// fetchJson optionally takes the { ip } urlSafety.js already validated for
// this exact url and, when given, pins the actual TCP connection to that
// literal address via undici's per-request `dispatcher` - closing the
// DNS-rebinding gap a plain "validate the hostname, then fetch the
// hostname" flow has (fetch() would otherwise re-resolve DNS on its own,
// after validation, and a short-TTL record can point somewhere else by
// then). The Host header/TLS SNI still come from `url` itself (undici's
// `connect.lookup` only overrides which address gets dialed, not what's
// sent on the wire), so this doesn't break virtual-hosted/SNI-routed
// ArcGIS services. Redirects are rejected outright rather than followed -
// a redirect target hasn't been validated at all, and this app's ArcGIS
// REST query calls have no legitimate reason to redirect.
async function fetchJson(url, pinnedAddress) {
  const dispatcher = pinnedAddress
    ? new Agent({
        connect: {
          lookup: (_hostname, _options, callback) => callback(null, pinnedAddress.ip, pinnedAddress.family)
        }
      })
    : undefined;

  const response = await fetch(url, { redirect: "manual", dispatcher });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Redirects are not allowed.");
  }

  const body = await response.json();
  if (!response.ok || body?.error) {
    const message = body?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function searchPortalLayers({ query }) {
  const text = (query || "").trim();
  if (!text) return { results: [] };

  const searchQuery = `(${text}) AND (type:"Feature Service")`;
  const url =
    `${config.arcgisPortalUrl}/sharing/rest/search?f=json&num=10` +
    `&q=${encodeURIComponent(searchQuery)}`;
  const body = await fetchJson(url);

  return {
    results: (body.results || [])
      .filter((item) => !!item.url)
      .map((item) => ({ id: item.id, title: item.title, snippet: item.snippet, owner: item.owner, url: item.url }))
  };
}

async function queryLayerFeatures({ url, where, outFields, resultRecordCount }) {
  const pinnedAddress = await resolveSafeAddress(url);

  const count = Math.min(Number(resultRecordCount) || DEFAULT_RECORD_COUNT, MAX_RECORD_COUNT);
  const fields = Array.isArray(outFields) && outFields.length > 0 ? outFields.join(",") : "*";
  const queryUrl =
    `${url}/query?f=json&returnGeometry=false` +
    `&where=${encodeURIComponent(where || "1=1")}` +
    `&outFields=${encodeURIComponent(fields)}` +
    `&resultRecordCount=${count}`;

  const body = await fetchJson(queryUrl, pinnedAddress);
  return { features: (body.features || []).map((f) => f.attributes) };
}

async function getLayerStatistics({ url, field, statisticType, where }) {
  const pinnedAddress = await resolveSafeAddress(url);

  const outStatistics = [
    { statisticType, onStatisticField: field, outStatisticFieldName: "result" }
  ];
  const queryUrl =
    `${url}/query?f=json&returnGeometry=false` +
    `&where=${encodeURIComponent(where || "1=1")}` +
    `&outStatistics=${encodeURIComponent(JSON.stringify(outStatistics))}`;

  const body = await fetchJson(queryUrl, pinnedAddress);
  const result = body.features?.[0]?.attributes?.result ?? null;
  return { field, statisticType, result };
}

module.exports = { searchPortalLayers, queryLayerFeatures, getLayerStatistics };
