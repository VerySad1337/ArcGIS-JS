import { getOneMapToken, invalidateOneMapToken } from "./OneMapAuthService";

describe("OneMapAuthService", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    invalidateOneMapToken();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("fetches a token from the same-origin proxy endpoint", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "abc123", expiresAt: Date.now() + 60 * 60 * 1000 })
    });

    const token = await getOneMapToken();

    expect(token).toBe("abc123");
    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/token");
  });

  test("caches the token and does not re-fetch while it's still valid", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "abc123", expiresAt: Date.now() + 60 * 60 * 1000 })
    });

    await getOneMapToken();
    await getOneMapToken();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("re-fetches once the cached token is within its expiry safety margin", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        // Already inside the 60s safety margin - should be treated as
        // needing a refresh, not as still valid.
        json: async () => ({ token: "expiring-soon", expiresAt: Date.now() + 1000 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "fresh", expiresAt: Date.now() + 60 * 60 * 1000 })
      });

    const first = await getOneMapToken();
    const second = await getOneMapToken();

    expect(first).toBe("expiring-soon");
    expect(second).toBe("fresh");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("invalidateOneMapToken forces the next call to re-fetch", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "abc123", expiresAt: Date.now() + 60 * 60 * 1000 })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: "def456", expiresAt: Date.now() + 60 * 60 * 1000 })
      });

    await getOneMapToken();
    invalidateOneMapToken();
    const token = await getOneMapToken();

    expect(token).toBe("def456");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("coalesces concurrent callers onto a single in-flight fetch", async () => {
    let resolveFetch;
    global.fetch = jest.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const first = getOneMapToken();
    const second = getOneMapToken();
    resolveFetch({
      ok: true,
      json: async () => ({ token: "abc123", expiresAt: Date.now() + 60 * 60 * 1000 })
    });

    await Promise.all([first, second]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("throws when the proxy endpoint responds with an error status", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false });

    await expect(getOneMapToken()).rejects.toThrow("OneMap sign-in is currently unavailable.");
  });
});
