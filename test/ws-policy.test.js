const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");

const {
  VSCODE_WS_ORIGIN,
  isAllowedWsOrigin
} = require("../src/main/ws-policy");

test("the VS Code bridge origin passes a real ws handshake", async (t) => {
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: (info) => isAllowedWsOrigin(info.origin)
  });
  t.after(() => server.close());
  await once(server, "listening");

  const address = server.address();
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`, {
    origin: VSCODE_WS_ORIGIN
  });
  t.after(() => client.close());
  await once(client, "open");

  assert.equal(client.readyState, WebSocket.OPEN);
  assert.equal(isAllowedWsOrigin(""), false);
  assert.equal(isAllowedWsOrigin("https://example.com"), false);
});
