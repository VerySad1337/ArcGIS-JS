import { sendChatMessage, sendToolResult } from "./ChatService";

describe("sendChatMessage", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("posts messages/mapContext to /api/chat and resolves the JSON body", async () => {
    const responseBody = { reply: "Hello!", pendingAction: null, messages: [] };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => responseBody });

    const messages = [{ role: "user", content: "hi" }];
    const mapContext = { is3D: false, layers: [], queryableLayerUrls: [] };
    const result = await sendChatMessage(messages, mapContext);

    expect(result).toEqual(responseBody);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chat/message",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, mapContext })
      })
    );
  });

  test("throws the proxy's own error message on a non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "The chat model is currently unavailable." })
    });

    await expect(sendChatMessage([{ role: "user", content: "hi" }], {})).rejects.toThrow(
      "The chat model is currently unavailable."
    );
  });

  test("falls back to a generic error when the failure response has no JSON body", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("not json");
      }
    });

    await expect(sendChatMessage([{ role: "user", content: "hi" }], {})).rejects.toThrow(
      "The chat assistant is currently unavailable."
    );
  });
});

describe("sendToolResult", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("posts messages/mapContext/callId/result to /api/chat/tool-result", async () => {
    const responseBody = { reply: "Done.", pendingAction: null, messages: [] };
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => responseBody });

    const messages = [{ role: "user", content: "add a heatmap" }];
    const mapContext = { is3D: false, layers: [] };
    const result = await sendToolResult(messages, mapContext, "call_1", { id: "heatmap_abc" });

    expect(result).toEqual(responseBody);
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chat/tool-result",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ messages, mapContext, callId: "call_1", result: { id: "heatmap_abc" } })
      })
    );
  });
});
