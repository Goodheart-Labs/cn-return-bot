import { describe, expect, test } from "bun:test";
import { loadSignalTransportConfig, parseIncomingMessage, SignalTransport, type IncomingMessage } from "./transport";

const internalId = Buffer.alloc(32, 1).toString("base64");
const restId = `group.${Buffer.from(internalId).toString("base64")}`;
const config = { apiUrl: "http://localhost:8080", number: "+15550001111", groupId: restId };
const sender = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const sentAt = 1_800_000_000_000;
function event(data: Record<string, unknown> = {}, envelope: Record<string, unknown> = {}) {
  return {
    account: config.number,
    envelope: {
      sourceUuid: sender,
      sourceNumber: "+15550002222",
      timestamp: sentAt,
      dataMessage: { timestamp: sentAt, message: "yes post", groupInfo: { groupId: internalId }, ...data },
      ...envelope,
    },
  };
}

class FakeSocket extends EventTarget {
  closeCount = 0;
  close() { this.closeCount++; this.dispatchEvent(new Event("close")); }
  receive(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
}

describe("Signal receive parsing", () => {
  test("normalizes REST group IDs and preserves the message and quote identity", () => {
    expect(parseIncomingMessage(event({ quote: { id: sentAt - 1, author: config.number, text: "Draft 1" } }), config)).toEqual({
      id: `${sender}:${sentAt}`, sender, timestamp: sentAt, text: "yes post",
      quoteId: String(sentAt - 1), quoteAuthor: config.number, quoteText: "Draft 1",
    });
  });

  test("supports groupV2, internal configured IDs, source numbers, and string timestamps", () => {
    expect(parseIncomingMessage(event({ groupInfo: undefined, groupV2: { id: internalId }, timestamp: String(sentAt) }, {
      sourceUuid: undefined,
    }), { ...config, groupId: internalId })?.sender).toBe("+15550002222");
  });

  test("never accepts other groups, direct messages, own messages or outgoing sync", () => {
    const ignored = [
      event({ groupInfo: { groupId: Buffer.alloc(32, 2).toString("base64") } }),
      event({ groupInfo: undefined }),
      event({}, { sourceNumber: config.number }),
      event({}, { syncMessage: { sentMessage: { message: "yes post" } } }),
      { ...event(), account: "+15550003333" },
      event({ message: " " }),
      event({ timestamp: -1 }, { timestamp: -1 }),
    ];
    for (const value of ignored) expect(parseIncomingMessage(value, config)).toBeNull();
    expect(parseIncomingMessage(event({}, { sourceNumber: undefined }), { ...config, botUuid: sender })).toBeNull();
  });

  test("reports bridge errors instead of treating them as unrelated messages", () => {
    expect(() => parseIncomingMessage({ error: "Account is not registered" }, config)).toThrow("Account is not registered");
  });

  test("self messages require explicit opt-in and use the original group sent transcript", () => {
    const selfEvent = {
      account: config.number,
      envelope: {
        sourceNumber: config.number, sourceUuid: sender, sourceDevice: 1,
        timestamp: sentAt + 10_000,
        syncMessage: { sentMessage: {
          timestamp: sentAt, message: "yes post", groupInfo: { groupId: internalId },
          quote: { id: sentAt - 100, author: config.number, text: "Draft" },
        } },
      },
    };
    expect(parseIncomingMessage(selfEvent, config)).toBeNull();
    expect(parseIncomingMessage(selfEvent, { ...config, acceptSelfMessages: true })).toEqual({
      id: `${config.number}:${sentAt}`, sender: config.number, timestamp: sentAt,
      text: "yes post", isSelf: true, quoteId: String(sentAt - 100), quoteAuthor: config.number, quoteText: "Draft",
    });
    expect(parseIncomingMessage(selfEvent, { ...config, acceptSelfMessages: true, botUuid: sender })?.sender).toBe(sender);
  });

  test("self opt-in still rejects receipts, edits, other accounts/groups, direct messages, and ordinary own envelopes", () => {
    const own = { ...config, acceptSelfMessages: true };
    const sentMessage = { timestamp: sentAt, message: "yes post", groupInfo: { groupId: internalId } };
    const syncEvent = (sent: Record<string, unknown>) => ({ account: config.number, envelope: {
      sourceNumber: config.number, timestamp: sentAt + 10_000, syncMessage: { sentMessage: sent },
    } });
    const ignored = [
      { account: config.number, envelope: { sourceNumber: config.number, syncMessage: { readMessages: [{ timestamp: sentAt }] } } },
      syncEvent({ ...sentMessage, groupInfo: undefined, destinationNumber: "+15550002222" }),
      syncEvent({ ...sentMessage, groupInfo: { groupId: Buffer.alloc(32, 2).toString("base64") } }),
      { ...syncEvent(sentMessage), account: "+15550003333" },
      syncEvent({ ...sentMessage, timestamp: undefined }),
      syncEvent({ ...sentMessage, editMessage: { dataMessage: sentMessage } }),
      event({}, { sourceNumber: config.number }),
    ];
    for (const value of ignored) expect(parseIncomingMessage(value, own)).toBeNull();
  });

  test("requires explicit valid configuration without a discovery mode", () => {
    expect(() => loadSignalTransportConfig({})).toThrow("SIGNAL_API_URL");
    expect(() => loadSignalTransportConfig({ SIGNAL_API_URL: config.apiUrl, SIGNAL_NUMBER: config.number })).toThrow("SIGNAL_GROUP_ID");
    expect(() => new SignalTransport({ ...config, groupId: "+15550004444" })).toThrow("SIGNAL_GROUP_ID");
    expect(() => new SignalTransport({ ...config, apiUrl: "file:///tmp/bridge" })).toThrow("http(s)");
    expect(loadSignalTransportConfig({ SIGNAL_API_URL: config.apiUrl, SIGNAL_NUMBER: config.number, SIGNAL_GROUP_ID: internalId })).toEqual({ ...config, groupId: internalId });
    expect(loadSignalTransportConfig({ SIGNAL_API_URL: config.apiUrl, SIGNAL_NUMBER: config.number, SIGNAL_GROUP_ID: internalId, SIGNAL_ACCEPT_SELF_MESSAGES: "true" }).acceptSelfMessages).toBe(true);
    expect(loadSignalTransportConfig({ SIGNAL_API_URL: config.apiUrl, SIGNAL_NUMBER: config.number, SIGNAL_GROUP_ID: internalId, SIGNAL_ACCEPT_SELF_MESSAGES: "false" }).acceptSelfMessages).toBeUndefined();
  });
});

describe("Signal sending", () => {
  test("sends to only the allowlisted group, quotes the original, and returns the server timestamp", async () => {
    let request: RequestInit | undefined;
    let requestedUrl: unknown;
    const transport = new SignalTransport({ ...config, groupId: internalId }, {
      fetch: async (url, options) => {
        requestedUrl = url;
        request = options;
        return new Response(JSON.stringify([{ timestamp: String(sentAt + 100) }]));
      },
    });
    const original = parseIncomingMessage(event(), config)!;
    const text = "Draft **literal**\nhttps://example.com/source";
    expect(await transport.send(text, original)).toBe(String(sentAt + 100));
    expect(requestedUrl).toBe("http://localhost:8080/v2/send");
    expect(JSON.parse(request!.body as string)).toEqual({
      number: config.number, recipients: [restId], message: text, text_mode: "normal",
      quote_timestamp: sentAt, quote_author: sender, quote_message: "yes post",
    });
    await transport.close();
  });

  test("does not retry ambiguous sends or hide partial delivery errors", async () => {
    for (const body of [
      [{ timestamp: String(sentAt), errors: { recipients: [{ reason: "UNREGISTERED_FAILURE" }] } }],
      [{}],
    ]) {
      let calls = 0;
      const transport = new SignalTransport(config, { fetch: async () => {
        calls++;
        return new Response(JSON.stringify(body));
      } });
      await expect(transport.send("Draft")).rejects.toThrow();
      expect(calls).toBe(1);
      await transport.close();
    }
  });

  test("preserves one timestamp per response by rejecting oversized text without sending", async () => {
    let calls = 0;
    const transport = new SignalTransport(config, { fetch: async () => {
      calls++;
      return new Response("{}");
    } });
    await expect(transport.send("a".repeat(6_001))).rejects.toThrow("6000");
    expect(calls).toBe(0);
    await transport.close();
  });
});

describe("Signal websocket lifecycle", () => {
  test("invokes receipt callbacks synchronously while earlier handlers are still running", async () => {
    const socket = new FakeSocket();
    let finish!: () => void;
    const slowHandler = new Promise<void>(resolve => { finish = resolve; });
    const received: string[] = [];
    const transport = new SignalTransport(config, { createSocket: () => socket });
    transport.connect(message => {
      received.push(message.text); // Engine's durable enqueue runs at this point.
      return slowHandler;
    });
    socket.receive(event({ message: "first" }));
    socket.receive(event({ message: "second", timestamp: sentAt + 1 }));
    expect(received).toEqual(["first", "second"]);
    let stopped = false;
    const closing = transport.close().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await closing;
    expect(stopped).toBe(true);
  });

  test("drains messages in receive order and visibly reports handler failures", async () => {
    const socket = new FakeSocket();
    const errors: Error[] = [];
    const received: IncomingMessage[] = [];
    let url = "";
    const transport = new SignalTransport(config, {
      createSocket: value => { url = value; return socket; },
      onError: error => errors.push(error),
    });
    transport.connect(async message => {
      received.push(message);
      if (message.text === "yes post") throw new Error("storage failed");
    });
    socket.dispatchEvent(new Event("open"));
    socket.receive(event());
    socket.receive(event({ message: "next message", timestamp: sentAt + 1 }));
    await transport.close();
    expect(url).toBe("ws://localhost:8080/v1/receive/%2B15550001111");
    expect(received.map(message => message.text)).toEqual(["yes post", "next message"]);
    expect(errors).toHaveLength(1);
    expect((errors[0]!.cause as Error).message).toBe("storage failed");
    expect(socket.closeCount).toBe(1);
    await expect(transport.send("After close")).rejects.toThrow("closed");
  });

  test("reconnects after failure and cancels reconnection on shutdown", async () => {
    const sockets: FakeSocket[] = [];
    const transport = new SignalTransport(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onError: () => {}, reconnectBaseMs: 1, reconnectMaxMs: 2,
    });
    transport.connect(() => {});
    sockets[0]!.dispatchEvent(new Event("error"));
    await Bun.sleep(10);
    expect(sockets.length).toBe(2);
    sockets[1]!.dispatchEvent(new Event("error"));
    await transport.close();
    await Bun.sleep(10);
    expect(sockets.length).toBe(2);
  });
});
