import type { WebSocketServer, WebSocket } from "ws";

export interface Transport<Client> {
  onConnection?: (handler: (client: Client) => void) => void;
  onMessage: (client: Client, handler: (data: string) => void) => void;
  onClose: (client: Client, handler: () => void) => void;
  send: (client: Client, data: string) => void;
  close: (client: Client) => void;
}

export function wsTransport(server: WebSocketServer): Transport<WebSocket> {
  return {
    onConnection: (handler) => server.on("connection", handler),
    onMessage: (client, handler) =>
      client.on("message", (data) => handler(data.toString())),
    onClose: (client, handler) => client.on("close", handler),
    send: (client, data) => client.send(data),
    close: (client) => client.close(),
  };
}
