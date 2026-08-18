import { memo, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

// A single user turn can trigger a chain of client (map-mutating) actions -
// e.g. "add the parks layer and buffer it" resolves to add_portal_layer
// then apply_buffer, one pendingAction round trip at a time (see
// knowledge/features/chatbot-mcp-system.md). mcp-chat-proxy caps its own
// server-tool hops per HTTP call (config.maxServerToolHops), but that
// counter resets on every /api/chat/tool-result call, so a runaway chain of
// client actions across many round trips needs its own, client-side cap.
const MAX_ACTION_CHAIN = 5;

function describeAction(pendingAction) {
  const label = pendingAction.name.replace(/_/g, " ");
  const name = pendingAction.args?.name || pendingAction.args?.id || pendingAction.args?.sourceId;
  return name ? `${label} (${name})` : label;
}

let nextTimelineId = 0;
function timelineEntry(role, text) {
  nextTimelineId += 1;
  return { id: nextTimelineId, role, text };
}

// Chat panel for the local-model MCP assistant. Deliberately ArcGIS/service
// agnostic, same as GlobalSearchPanel/AnalysisPanel: it never imports
// ChatService or GISMapEngine directly, only the three callback props
// ApplicationShell supplies (onSendMessage/onSubmitToolResult wrap
// ChatService; onRunClientAction wraps the real engine handlers via
// ApplicationShell's chatActionExecutor). `protocolMessages` is the literal
// message array mcp-chat-proxy round-trips (including its own system/tool
// entries) - resent verbatim on every call, never reconstructed here.
// `timeline` is a separate, display-only log (user/assistant text plus
// "Running/Applied/Failed" lines for executed actions) so rendering never
// has to reverse-engineer tool_call bookkeeping from the protocol array.
function ChatPanel({ mapContext, onSendMessage, onSubmitToolResult, onRunClientAction }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [protocolMessages, setProtocolMessages] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [sending, setSending] = useState(false);

  const appendTimeline = (role, text) => setTimeline((prev) => [...prev, timelineEntry(role, text)]);

  const handleLoopResult = async (result, chainDepth) => {
    setProtocolMessages(result.messages || []);

    if (!result.pendingAction) {
      if (result.reply) appendTimeline("assistant", result.reply);
      return;
    }

    if (chainDepth >= MAX_ACTION_CHAIN) {
      appendTimeline("error", "Stopped after several chained actions - ask a follow-up to continue.");
      return;
    }

    const { pendingAction } = result;
    appendTimeline("action", `Running: ${describeAction(pendingAction)}`);

    const outcome = await onRunClientAction(pendingAction.name, pendingAction.args);
    appendTimeline(
      outcome.ok ? "action" : "error",
      outcome.ok ? `Applied: ${describeAction(pendingAction)}` : `Failed: ${outcome.error}`
    );

    const next = await onSubmitToolResult(result.messages, mapContext, pendingAction.callId, outcome);
    await handleLoopResult(next, chainDepth + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    appendTimeline("user", text);
    setSending(true);
    try {
      const nextMessages = [...protocolMessages, { role: "user", content: text }];
      const result = await onSendMessage(nextMessages, mapContext);
      await handleLoopResult(result, 0);
    } catch (err) {
      appendTimeline("error", err.message || "The chat assistant is currently unavailable.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="panel-card chat-panel">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>CHAT</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <div className="chat-timeline" role="log" aria-live="polite">
            {timeline.length === 0 && (
              <p className="analysis-tool-hint">
                Ask about the portal, the current map, or tell it what to do - e.g. "search the portal for parks" or
                "add a heatmap of tourist attractions".
              </p>
            )}
            {timeline.map((entry) => (
              <div key={entry.id} className={`chat-message chat-message-${entry.role}`}>
                {entry.text}
              </div>
            ))}
            {sending && <div className="chat-message chat-message-pending">Thinking…</div>}
          </div>

          <form className="chat-input-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the assistant…"
              aria-label="Chat message"
              disabled={sending}
            />
            <button type="submit" className="gis-button" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

ChatPanel.propTypes = {
  mapContext: PropTypes.shape({
    is3D: PropTypes.bool,
    layers: PropTypes.array,
    queryableLayerUrls: PropTypes.array
  }).isRequired,
  onSendMessage: PropTypes.func.isRequired,
  onSubmitToolResult: PropTypes.func.isRequired,
  onRunClientAction: PropTypes.func.isRequired
};

// Memoized like every other panel-card - mapContext/handlers are the only
// props, and ApplicationShell keeps the handlers useCallback-stabilized and
// mapContext a freshly-derived-but-shallow object each render (same
// "layers" data refreshLayers() already computes, no new engine state).
export default memo(ChatPanel);
