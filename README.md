# stomp-server-adapter

A transport-agnostic STOMP protocol (compliant with V1.0) implementation in TypeScript

## Usage

### With `ws`

```js
import { WebSocketServer } from "ws";
import { StompServerAdapter, wsTransport } from "stomp-server-adapter";

const wss = new WebSocketServer({ port: 9090 });

const stompServer = new StompServerAdapter(wsTransport(wss));

stompServer.on("/topic/foo", (message) => {
  console.log(`[/topic/foo] ${message.body}`);
});

stompServer.onAny((topic, message) => {
  console.log(`onAny: [${topic}] ${message.body}`);
});

setInterval(() => {
  stompServer.publish("/topic/foo", "Hello from Node.js!");
}, 5 * 1000);
```

### With other transports

Define an object that implements the `Transport` interface:

```js
interface Transport<Client> {
  onConnection?: (handler: (client: Client) => void) => void;
  onMessage: (client: Client, handler: (data: string) => void) => void;
  onClose: (client: Client, handler: () => void) => void;
  send: (client: Client, data: string) => void;
  close: (client: Client) => void;
}
```

Playwright example:

```ts
import { test, WebSocketRoute } from "@playwright/test";
import { StompServerAdapter, Transport } from "stomp-server-adapter";

const playwrightWsTransport: Transport<WebSocketRoute> = {
  onMessage: (client, handler) =>
    client.onMessage((data) => handler(data.toString())),
  onClose: (client, handler) => client.onClose(handler),
  send: (client, data) => client.send(data),
  close: (client) => client.close(),
};

let stompServer: StompServerAdapter<WebSocketRoute>;

test.beforeEach(({ page }) => {
  stompServer = new StompServerAdapter(playwrightWsTransport);

  page.routeWebSocket("ws://example.org/ws", (ws) => {
    // This is only needed because our transport doesn't implement `onConnection`
    stompServer.handleConnection(ws);
  });
});

test.afterEach(() => {
  stompServer.close();
});
```
