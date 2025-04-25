import { StompFrame, StompHeaders } from "./frame";
import type { Transport } from "./transport";

interface ClientInfo {
  sessionId: string;
  subscriptions: Map<string, string>; // id -> destination
}

export class StompServerAdapter<Client> {
  private clients: Map<Client, ClientInfo>;
  private subscriptions: Map<string, Map<Client, string>>; // destination -> clients -> subId

  private wildcardCbs: ((destination: string, frame: StompFrame) => void)[] = [];
  private subscriptionCbs: Map<string, ((frame: StompFrame) => void)[]> = new Map();

  constructor(private transport: Transport<Client>) {
    this.clients = new Map();
    this.subscriptions = new Map();

    transport.onConnection?.((client) =>
      this.handleConnection(client)
    );
  }

  public publish(destination: string, body: string, headers: StompHeaders = {}): void {
    const messageFrame = new StompFrame('MESSAGE', {
      destination,
      'message-id': Math.random().toString(36).substring(2),
      'content-type': headers['content-type'] || 'text/plain',
      ...headers
    }, body);

    this.sendFrame(destination, messageFrame);
  }

  public on(
    destination: string,
    callback: (frame: StompFrame) => void
  ): (() => void) {
    let cbs = this.subscriptionCbs.get(destination);
    if (!cbs) {
      cbs = [];
      this.subscriptionCbs.set(destination, cbs);
    }
    cbs.push(callback);
    return () => {
      const index = cbs!.indexOf(callback);
      if (index !== -1) {
        cbs!.splice(index, 1);
      }
      if (cbs!.length === 0) {
        this.subscriptionCbs.delete(destination);
      }
    }
  }

  public onAny(
    callback: (destination: string, frame: StompFrame) => void
  ): (() => void) {
    this.wildcardCbs.push(callback);
    return () => {
      const index = this.wildcardCbs.indexOf(callback);
      if (index !== -1) {
        this.wildcardCbs.splice(index, 1);
      }
    };
  }

  public handleConnection(client: Client): void {
    const sessionId = Math.random().toString(36).substring(2);
    this.clients.set(client, { sessionId, subscriptions: new Map() });

    this.transport.onMessage(client, (data) =>
      this.handleMessage(client, data)
    );
    this.transport.onClose(client, () => this.handleDisconnect(client));

    const connectedFrame = new StompFrame("CONNECTED", {
      "session-id": sessionId,
      server: 'stomp-server-adapter',
      version: "1.0",
    });
    this.transport.send(client, connectedFrame.toString());
  }

  public close(): void {
    this.clients.forEach((_, client) => this.handleDisconnect(client));
    this.clients.clear();
    this.subscriptions.clear();
    this.wildcardCbs = [];
    this.subscriptionCbs.clear();
  }

  private handleMessage(client: Client, data: string): void {
    try {
      // Just to make it more resilient if the final user ain't using TS and sends a buffer instead
      data = data.toString();

      const frame = StompFrame.parse(data);
      switch (frame.command) {
        case "CONNECT":
          break;
        case "SUBSCRIBE":
          this.handleSubscribe(client, frame);
          break;
        case "SEND":
          this.handleSend(client, frame);
          break;
        case "UNSUBSCRIBE":
          this.handleUnsubscribe(client, frame);
          break;
        case "DISCONNECT":
          this.handleDisconnect(client);
          break;
        default:
          this.sendError(client, `Unsupported command: ${frame.command}`);
      }
    } catch (error) {
      this.sendError(
        client,
        `Error processing message: ${(error as Error).message}`
      );
    }
  }

  private handleSubscribe(client: Client, frame: StompFrame): void {
    const destination = frame.headers["destination"];
    const id = frame.headers["id"];
    if (!destination || !id) {
      this.sendError(client, "Missing required headers: destination and id");
      return;
    }

    const clientInfo = this.clients.get(client)!;
    clientInfo.subscriptions.set(id, destination);

    if (!this.subscriptions.has(destination)) {
      this.subscriptions.set(destination, new Map());
    }
    this.subscriptions.get(destination)!.set(client, id);

    if (frame.headers["receipt"]) {
      const receiptFrame = new StompFrame("RECEIPT", {
        "receipt-id": frame.headers["receipt"],
      });
      this.transport.send(client, receiptFrame.toString());
    }
  }

  private handleSend(client: Client, frame: StompFrame): void {
    const destination = frame.headers["destination"];
    if (!destination) {
      this.sendError(client, "Missing required header: destination");
      return;
    }

    if (this.subscriptions.has(destination)) {
      const messageFrame = new StompFrame(
        "MESSAGE",
        {
          destination: destination,
          "message-id": Math.random().toString(36).substring(2),
          "content-type": frame.headers["content-type"] || "text/plain",
        },
        frame.body
      );

      this.sendFrame(destination, messageFrame);
    }
  }

  private handleUnsubscribe(client: Client, frame: StompFrame): void {
    const id = frame.headers["id"];
    if (!id) {
      this.sendError(client, "Missing required header: id");
      return;
    }

    const clientInfo = this.clients.get(client);
    if (!clientInfo) {
      this.sendError(client, "Client not found");
      return;
    }

    const destination = clientInfo.subscriptions.get(id);
    if (!destination) {
      this.sendError(client, `No subscription found for id: ${id}`);
      return;
    }

    clientInfo.subscriptions.delete(id);

    const destinationClients = this.subscriptions.get(destination);
    if (destinationClients) {
      destinationClients.delete(client);
      if (destinationClients.size === 0) {
        this.subscriptions.delete(destination);
      }
    }

    if (frame.headers["receipt"]) {
      const receiptFrame = new StompFrame("RECEIPT", {
        "receipt-id": frame.headers["receipt"],
      });
      this.transport.send(client, receiptFrame.toString());
    }
  }

  private handleDisconnect(client: Client): void {
    const clientInfo = this.clients.get(client);
    if (clientInfo) {
      for (const destination of clientInfo.subscriptions.values()) {
        const destinationClients = this.subscriptions.get(destination);
        if (destinationClients) {
          destinationClients.delete(client);
          if (destinationClients.size === 0) {
            this.subscriptions.delete(destination);
          }
        }
      }
      this.clients.delete(client);
    }
    this.transport.close(client);
  }

  private sendError(client: Client, message: string): void {
    const errorFrame = new StompFrame("ERROR", { message });
    this.transport.send(client, errorFrame.toString());
  }

  private sendFrame(destination: string, frame: StompFrame): void {
    this.subscriptions.get(destination)?.forEach((subId, client) => {
      frame.setHeader("subscription", subId);
      this.transport.send(client, frame.toString());
    });
    this.wildcardCbs.forEach((cb) => cb(destination, frame));
    this.subscriptionCbs.get(destination)?.forEach((cb) => cb(frame));
  }
}
