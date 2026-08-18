import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatPanel from "./ChatPanel";

const mapContext = { is3D: false, layers: [], queryableLayerUrls: [] };

async function openPanel(user) {
  await user.click(screen.getByRole("button", { name: /CHAT/ }));
}

describe("ChatPanel", () => {
  test("is collapsed by default and expands on click", async () => {
    const user = userEvent.setup();
    render(
      <ChatPanel
        mapContext={mapContext}
        onSendMessage={jest.fn()}
        onSubmitToolResult={jest.fn()}
        onRunClientAction={jest.fn()}
      />
    );

    expect(screen.queryByLabelText("Chat message")).not.toBeInTheDocument();
    await openPanel(user);
    expect(screen.getByLabelText("Chat message")).toBeInTheDocument();
  });

  test("sends a message and renders a plain-text reply", async () => {
    const user = userEvent.setup();
    const onSendMessage = jest.fn().mockResolvedValue({
      reply: "Here's what's on your map.",
      pendingAction: null,
      messages: [{ role: "user", content: "what layers are on the map" }]
    });

    render(
      <ChatPanel
        mapContext={mapContext}
        onSendMessage={onSendMessage}
        onSubmitToolResult={jest.fn()}
        onRunClientAction={jest.fn()}
      />
    );
    await openPanel(user);

    await user.type(screen.getByLabelText("Chat message"), "what layers are on the map");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(onSendMessage).toHaveBeenCalledWith(
      [{ role: "user", content: "what layers are on the map" }],
      mapContext
    );
    expect(await screen.findByText("Here's what's on your map.")).toBeInTheDocument();
    expect(screen.getByLabelText("Chat message")).toHaveValue("");
  });

  test("executes a pendingAction via onRunClientAction and reports the outcome via onSubmitToolResult", async () => {
    const user = userEvent.setup();
    const pendingMessages = [{ role: "user", content: "add a heatmap" }];
    const onSendMessage = jest.fn().mockResolvedValue({
      reply: null,
      pendingAction: { name: "create_heatmap_layer", args: { sourceId: "touristAttractions", name: "Heat" }, callId: "call_1" },
      messages: pendingMessages
    });
    const onRunClientAction = jest.fn().mockResolvedValue({ ok: true, data: { id: "heatmap_1" } });
    const onSubmitToolResult = jest.fn().mockResolvedValue({
      reply: "Added the heatmap layer.",
      pendingAction: null,
      messages: [...pendingMessages, { role: "tool", tool_call_id: "call_1", content: "{}" }]
    });

    render(
      <ChatPanel
        mapContext={mapContext}
        onSendMessage={onSendMessage}
        onSubmitToolResult={onSubmitToolResult}
        onRunClientAction={onRunClientAction}
      />
    );
    await openPanel(user);

    await user.type(screen.getByLabelText("Chat message"), "add a heatmap");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/Applied: create heatmap layer/)).toBeInTheDocument();
    expect(onRunClientAction).toHaveBeenCalledWith("create_heatmap_layer", {
      sourceId: "touristAttractions",
      name: "Heat"
    });
    expect(onSubmitToolResult).toHaveBeenCalledWith(
      pendingMessages,
      mapContext,
      "call_1",
      { ok: true, data: { id: "heatmap_1" } }
    );
    expect(await screen.findByText("Added the heatmap layer.")).toBeInTheDocument();
  });

  test("shows a failure line without crashing when onRunClientAction reports an error", async () => {
    const user = userEvent.setup();
    const onSendMessage = jest.fn().mockResolvedValue({
      reply: null,
      pendingAction: { name: "apply_buffer", args: { distance: 100 }, callId: "call_2" },
      messages: []
    });
    const onRunClientAction = jest.fn().mockResolvedValue({ ok: false, error: "No feature selected." });
    const onSubmitToolResult = jest.fn().mockResolvedValue({ reply: "No feature was selected to buffer.", pendingAction: null, messages: [] });

    render(
      <ChatPanel
        mapContext={mapContext}
        onSendMessage={onSendMessage}
        onSubmitToolResult={onSubmitToolResult}
        onRunClientAction={onRunClientAction}
      />
    );
    await openPanel(user);

    await user.type(screen.getByLabelText("Chat message"), "buffer the selected feature");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Failed: No feature selected.")).toBeInTheDocument();
  });

  test("shows an error line when onSendMessage rejects", async () => {
    const user = userEvent.setup();
    const onSendMessage = jest.fn().mockRejectedValue(new Error("The chat model is currently unavailable."));

    render(
      <ChatPanel
        mapContext={mapContext}
        onSendMessage={onSendMessage}
        onSubmitToolResult={jest.fn()}
        onRunClientAction={jest.fn()}
      />
    );
    await openPanel(user);

    await user.type(screen.getByLabelText("Chat message"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The chat model is currently unavailable.")).toBeInTheDocument();
  });
});
