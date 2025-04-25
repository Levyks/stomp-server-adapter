export interface StompHeaders {
  [key: string]: string;
}

export class StompFrame {
  command: string;
  headers: StompHeaders;
  body: string;

  constructor(command: string, headers: StompHeaders = {}, body: string = "") {
    this.command = command;
    this.headers = headers;
    this.body = body;
  }

  toString(): string {
    let frame = `${this.command}\n`;
    for (const [key, value] of Object.entries(this.headers)) {
      frame += `${key}:${value}\n`;
    }
    if (!this.headers["content-length"]) {
      frame += `content-length:${this.body.length}\n`;
    }
    frame += "\n";
    frame += this.body;
    frame += "\0";
    return frame;
  }

  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  static parse(data: string): StompFrame {
    let pos = 0;
    let nextNewline = data.indexOf("\n", pos);
    if (nextNewline === -1) {
      throw new Error("Invalid STOMP frame: missing command");
    }
    const command = data.slice(pos, nextNewline).trim();
    pos = nextNewline + 1;

    const headers: StompHeaders = {};
    let body = "";
    let readingBody = false;

    while (pos < data.length) {
      nextNewline = data.indexOf("\n", pos);
      if (nextNewline === -1) {
        if (readingBody) {
          body += data.slice(pos);
        }
        break;
      }

      const line = data.slice(pos, nextNewline).trim();
      pos = nextNewline + 1;

      if (line === "") {
        readingBody = true;
        continue;
      }

      if (readingBody) {
        body += line + "\n";
      } else {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) {
          throw new Error("Invalid header format");
        }
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    return new StompFrame(command, headers, body.trim());
  }
}
