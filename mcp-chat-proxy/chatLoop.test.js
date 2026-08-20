// Covers the deterministic "add a portal layer, then rename it to the name
// the user actually asked for" chaining in submitToolResult - the fix for a
// real, user-visible failure where the layer was added under its portal
// title, no rename ever happened, and the model then claimed it had renamed
// it anyway. See knowledge/features/chatbot-mcp-system.md.
//
// Run with `npm test` (node --test) from mcp-chat-proxy/.

// config.js validates these at require time and exits the process if any is
// missing, so they must be set before chatLoop (and its config require) is
// loaded. No network call is made by any test here.
process.env.OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama.test:11434";
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL || "test-model";
process.env.ARCGIS_PORTAL_URL = process.env.ARCGIS_PORTAL_URL || "https://portal.test";

const test = require("node:test");
const assert = require("node:assert/strict");

const chatLoop = require("./chatLoop");
const ollamaClient = require("./ollamaClient");

const ADD_CALL_ID = "add_portal_layer_0_0";

// The transcript as it exists at the moment the browser reports back that
// add_portal_layer succeeded: the user's request, then the assistant turn
// whose tool call chatLoop already stamped with ADD_CALL_ID.
function transcriptAfterAdd(userText) {
  return [
    { role: "system", content: "(replaced by withSystemMessage)" },
    { role: "user", content: userText },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: ADD_CALL_ID,
          type: "function",
          function: {
            name: "add_portal_layer",
            arguments: { item: { id: "abc123", title: "Singapore Country Boundary", url: "https://portal.test/rest/0" } }
          }
        }
      ]
    }
  ];
}

const ADD_SUCCEEDED = { ok: true, data: { id: "portal_1", title: "Singapore Country Boundary" } };

// Any test that expects the loop to reach the model must stub this - an
// unstubbed call would try to reach OLLAMA_URL. A test that asserts a
// deterministic pendingAction is returned instead relies on the model NOT
// being consulted, so it stubs a throwing chat to prove that.
function stubOllama(t, impl) {
  const original = ollamaClient.chat;
  ollamaClient.chat = impl;
  t.after(() => {
    ollamaClient.chat = original;
  });
}

test("renames the added layer to the name the user asked for, without consulting the model", async (t) => {
  stubOllama(t, async () => {
    throw new Error("the model must not be consulted for a rename the user already spelled out");
  });

  const result = await chatLoop.submitToolResult(
    transcriptAfterAdd("add Singapore Boundary and name it SCB"),
    {},
    ADD_CALL_ID,
    ADD_SUCCEEDED
  );

  assert.equal(result.reply, null);
  assert.deepEqual(result.pendingAction.name, "rename_layer");
  assert.deepEqual(result.pendingAction.args, { id: "portal_1", name: "SCB" });

  // The synthetic assistant turn the browser's next tool result will
  // reference by tool_call_id.
  const last = result.messages[result.messages.length - 1];
  assert.equal(last.role, "assistant");
  assert.equal(last.tool_calls[0].id, result.pendingAction.callId);
  assert.equal(last.tool_calls[0].function.name, "rename_layer");
});

test("stops the naming clause at the next clause boundary", async (t) => {
  stubOllama(t, async () => {
    throw new Error("the model must not be consulted");
  });

  const result = await chatLoop.submitToolResult(
    transcriptAfterAdd("add Singapore Boundary, call it SCB and then zoom to it"),
    {},
    ADD_CALL_ID,
    ADD_SUCCEEDED
  );

  assert.equal(result.pendingAction.args.name, "SCB");
});

for (const userText of [
  "add the Singapore Country Boundary layer",
  // "named X" identifies which layer to add far more often than it renames
  // the added one, so it is deliberately not treated as a rename request.
  "add the layer named Singapore Country Boundary"
]) {
  test(`no rename is emitted for: "${userText}"`, async (t) => {
    stubOllama(t, async () => ({ role: "assistant", content: "Added it." }));

    const result = await chatLoop.submitToolResult(transcriptAfterAdd(userText), {}, ADD_CALL_ID, ADD_SUCCEEDED);

    assert.equal(result.pendingAction, null);
    assert.equal(result.reply, "Added it.");
  });
}

test("no rename is emitted when the requested name already matches the added title", async (t) => {
  stubOllama(t, async () => ({ role: "assistant", content: "Added it." }));

  const result = await chatLoop.submitToolResult(
    transcriptAfterAdd("add Singapore Boundary and name it Singapore Country Boundary"),
    {},
    ADD_CALL_ID,
    ADD_SUCCEEDED
  );

  assert.equal(result.pendingAction, null);
});

test("no rename is emitted when the add itself failed", async (t) => {
  stubOllama(t, async () => ({ role: "assistant", content: "That didn't work." }));

  const result = await chatLoop.submitToolResult(
    transcriptAfterAdd("add Singapore Boundary and name it SCB"),
    {},
    ADD_CALL_ID,
    { ok: false, error: "No such layer." }
  );

  assert.equal(result.pendingAction, null);
});

// "Filter out the Tampines stations" is ambiguous English. Observed in docker
// logs: qwen2.5:1.5b read it as exclusion, calling set_layer_filter with "="
// (matches nothing - the real value is "TAMPINES MRT STATION") and then
// retrying with "<>" (matches every row, so the layer filtered to everything).
// This app treats "filter out X" as narrowing, which is what its users mean -
// the same request went on to ask to zoom to the specific station.
function filterCall(userText, operator) {
  return [
    { role: "system", content: "(replaced)" },
    { role: "user", content: userText },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "set_layer_filter_0_0",
          type: "function",
          function: {
            name: "set_layer_filter",
            arguments: { id: "mrtStations", conditions: [{ field: "NAME", operator, value: "Tampines" }] }
          }
        }
      ]
    }
  ];
}

// startChat is used (not submitToolResult) so the tool call travels the normal
// processToolCall path; the stubbed model just replays the call above.
async function pendingFilterFor(t, userText, operator) {
  const messages = filterCall(userText, operator);
  stubOllama(t, async () => messages[2]);
  const result = await chatLoop.startChat([messages[1]], {});
  return result.pendingAction;
}

for (const [userText, operator, expected] of [
  ["filter out tampines mrt stations from mrt stations and zoom to layer", "<>", "="],
  ["show only tampines stations", "doesNotContain", "contains"],
  // Explicit exclusion wording is honoured in the other direction.
  ["exclude tampines stations", "=", "<>"],
  ["remove anything mentioning tampines", "contains", "doesNotContain"]
]) {
  test(`"${userText}" flips ${operator} to ${expected}`, async (t) => {
    const pendingAction = await pendingFilterFor(t, userText, operator);
    assert.equal(pendingAction.args.conditions[0].operator, expected);
  });
}

for (const [label, userText, operator] of [
  // Both kinds of wording present - no way to tell, so the model's own choice
  // stands rather than being flipped on a coin toss.
  ["ambiguous phrasing", "show only the stations, excluding tampines", "<>"],
  ["neither kind of phrasing", "tampines", "<>"],
  // Nothing to flip: a comparison operator with no opposite in the table.
  ["an unrelated operator", "filter out tampines stations", "startsWith"]
]) {
  test(`leaves the operator alone for ${label}`, async (t) => {
    const pendingAction = await pendingFilterFor(t, userText, operator);
    assert.equal(pendingAction.args.conditions[0].operator, operator);
  });
}

// Confirmed from docker logs: asked to "filter out tampines mrt stations from
// mrt stations and zoom to layer", the model made two set_layer_filter calls
// and never called zoom_to_layer at all. ChatPanel runs one client action per
// assistant turn, so the second half of the request depended entirely on the
// model asking again - which it didn't.
function filterResultTranscript(userText) {
  return [
    { role: "system", content: "(replaced)" },
    { role: "user", content: userText },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "set_layer_filter_0_0",
          type: "function",
          function: { name: "set_layer_filter", arguments: { id: "mrtStations", conditions: [] } }
        }
      ]
    }
  ];
}

test("zooms to the filtered layer when the user asked to, without the model calling zoom_to_layer", async (t) => {
  stubOllama(t, async () => {
    throw new Error("the model must not be consulted for a zoom the user already asked for");
  });

  const result = await chatLoop.submitToolResult(
    filterResultTranscript("filter out tampines mrt stations from mrt stations and zoom to layer"),
    {},
    "set_layer_filter_0_0",
    { ok: true, data: { active: true } }
  );

  assert.equal(result.pendingAction.name, "zoom_to_layer");
  assert.deepEqual(result.pendingAction.args, { id: "mrtStations" });
});

test("does not zoom when the user never asked to, or when a zoom to that layer already happened", async (t) => {
  stubOllama(t, async () => ({ role: "assistant", content: "Filtered." }));

  const noZoomRequest = await chatLoop.submitToolResult(
    filterResultTranscript("filter out tampines mrt stations"),
    {},
    "set_layer_filter_0_0",
    { ok: true, data: { active: true } }
  );
  assert.equal(noZoomRequest.pendingAction, null);

  // The model asked for the zoom itself earlier in the turn - deriving a
  // second one would move the camera twice for one request.
  const alreadyZoomed = filterResultTranscript("filter tampines stations and zoom to layer");
  alreadyZoomed.splice(2, 0, {
    role: "assistant",
    content: "",
    tool_calls: [
      { id: "zoom_0", type: "function", function: { name: "zoom_to_layer", arguments: { id: "mrtStations" } } }
    ]
  });
  const second = await chatLoop.submitToolResult(alreadyZoomed, {}, "set_layer_filter_0_0", {
    ok: true,
    data: { active: true }
  });
  assert.equal(second.pendingAction, null);
});

test("does not zoom when the filter itself failed", async (t) => {
  stubOllama(t, async () => ({ role: "assistant", content: "That failed." }));

  const result = await chatLoop.submitToolResult(
    filterResultTranscript("filter tampines stations and zoom to layer"),
    {},
    "set_layer_filter_0_0",
    { ok: false, error: "no such field" }
  );

  assert.equal(result.pendingAction, null);
});

test("the auto-rename's own result resumes the model loop instead of renaming again", async (t) => {
  let modelCalls = 0;
  stubOllama(t, async () => {
    modelCalls += 1;
    return { role: "assistant", content: 'Added "Singapore Country Boundary" and renamed it to SCB.' };
  });

  const afterAdd = await chatLoop.submitToolResult(
    transcriptAfterAdd("add Singapore Boundary and name it SCB"),
    {},
    ADD_CALL_ID,
    ADD_SUCCEEDED
  );

  const afterRename = await chatLoop.submitToolResult(afterAdd.messages, {}, afterAdd.pendingAction.callId, {
    ok: true,
    data: { id: "portal_1", name: "SCB" }
  });

  assert.equal(afterRename.pendingAction, null);
  assert.equal(afterRename.reply, 'Added "Singapore Country Boundary" and renamed it to SCB.');
  assert.equal(modelCalls, 1);
});

// --- Freeing Ollama's RAM once a turn is over -------------------------------
// OLLAMA_UNLOAD_AFTER_TURN evicts the model when the turn genuinely ends. The
// distinction these tests pin down is the whole reason it isn't just
// OLLAMA_KEEP_ALIVE=0: a pendingAction return is mid-turn, and unloading
// there would reload the model in the middle of one user request.
const config = require("./config");

function stubUnload(t) {
  const originalUnload = ollamaClient.unloadModel;
  const originalFlag = config.ollamaUnloadAfterTurn;
  const calls = [];
  ollamaClient.unloadModel = async () => {
    calls.push(Date.now());
  };
  config.ollamaUnloadAfterTurn = true;
  t.after(() => {
    ollamaClient.unloadModel = originalUnload;
    config.ollamaUnloadAfterTurn = originalFlag;
  });
  return calls;
}

// releaseModelAfterTurn is fire-and-forget, so the unload is queued as a
// microtask rather than awaited by the caller - let it run before asserting.
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("frees the model's RAM once the model has given a final text answer", async (t) => {
  const calls = stubUnload(t);
  stubOllama(t, async () => ({ role: "assistant", content: "There are 42 stations." }));

  const result = await chatLoop.startChat([{ role: "user", content: "how many stations?" }], {});
  await settle();

  assert.equal(result.pendingAction, null);
  assert.equal(calls.length, 1, "a finished turn should hand the RAM back");
});

test("does not free the model mid-turn, while a client action is still owed", async (t) => {
  const calls = stubUnload(t);
  stubOllama(t, async () => ({
    role: "assistant",
    content: "",
    tool_calls: [{ type: "function", function: { name: "zoom_to_layer", arguments: { id: "mrtStations" } } }]
  }));

  const result = await chatLoop.startChat([{ role: "user", content: "zoom to mrt stations" }], {});
  await settle();

  assert.equal(result.pendingAction.name, "zoom_to_layer");
  assert.equal(calls.length, 0, "the browser is about to come straight back - unloading here costs a reload");
});

test("frees the model when the turn fails, and rethrows the original error", async (t) => {
  const calls = stubUnload(t);
  stubOllama(t, async () => {
    throw new Error("Ollama request failed (500): boom");
  });

  await assert.rejects(
    () => chatLoop.startChat([{ role: "user", content: "hello" }], {}),
    /Ollama request failed/
  );
  await settle();

  assert.equal(calls.length, 1, "a failed turn is the last thing that should leave RAM pinned");
});

test("leaves the model resident when the option is off", async (t) => {
  const calls = stubUnload(t);
  config.ollamaUnloadAfterTurn = false;
  stubOllama(t, async () => ({ role: "assistant", content: "hi" }));

  await chatLoop.startChat([{ role: "user", content: "hello" }], {});
  await settle();

  assert.equal(calls.length, 0, "default behaviour must be unchanged");
});

test("an unload that fails is logged, not surfaced as a failed chat", async (t) => {
  stubUnload(t);
  ollamaClient.unloadModel = async () => {
    throw new Error("connection refused");
  };
  stubOllama(t, async () => ({ role: "assistant", content: "hi" }));

  const result = await chatLoop.startChat([{ role: "user", content: "hello" }], {});
  await settle();

  assert.equal(result.reply, "hi", "a missed optimisation must not become a user-visible error");
});
