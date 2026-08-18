// Shared SSRF guard for every tool that takes a caller-supplied URL
// (query_layer_features / get_layer_statistics). Independent of any
// per-conversation allow-list (see chatLoop.js for the additional,
// app-specific "must be a layer already on the user's map" check) because
// this module also backs the standalone MCP server exposed at /mcp for
// external MCP clients, which have no such conversation context at all -
// this is the one guard that always applies, regardless of caller.
//
// Blocks anything that isn't a plain https URL, and anything whose
// hostname resolves to a loopback/private/link-local address - the classes
// of address that would turn this server-side fetch into a way to reach
// the Docker-internal network, the deploy host's localhost, or a cloud
// metadata endpoint (169.254.169.254) rather than a real ArcGIS service.
//
// Resolve-then-fetch is a classic TOCTOU: validating a hostname's DNS
// result and then handing the same hostname string to fetch() lets fetch
// re-resolve independently, and a short-TTL DNS record can legitimately
// point somewhere public at check time and somewhere private by the time
// the real connection happens ("DNS rebinding"). resolveSafeAddress below
// returns the exact IP it validated; callers (portalTools.js) must connect
// to that literal address instead of re-resolving the hostname themselves.
const dns = require("dns").promises;
const net = require("net");

function isPrivateOrLoopbackIp(ip) {
  const family = net.isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 0) return true;
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    return false;
  }
  return true; // couldn't parse - treat as unsafe
}

// Validates rawUrl and returns { hostname, ip, family } - the single
// resolved address the caller must pin its actual connection to. Throws on
// anything non-https, unresolvable, or resolving to a private/loopback/
// link-local address.
async function resolveSafeAddress(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Only https:// URLs are allowed.");
  }

  const hostname = parsed.hostname;
  if (hostname === "localhost") {
    throw new Error("Requests to localhost are not allowed.");
  }

  // A bare IP literal in the URL skips DNS entirely - it IS the address.
  if (net.isIP(hostname)) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`Requests to ${hostname} are not allowed.`);
    }
    return { hostname, ip: hostname, family: net.isIP(hostname) };
  }

  let address;
  try {
    address = await dns.lookup(hostname);
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }

  if (isPrivateOrLoopbackIp(address.address)) {
    throw new Error(`Requests to ${hostname} are not allowed.`);
  }

  return { hostname, ip: address.address, family: address.family };
}

module.exports = { resolveSafeAddress };
