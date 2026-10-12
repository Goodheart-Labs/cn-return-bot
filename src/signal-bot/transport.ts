/** Transport for bbernhard/signal-cli-rest-api running in MODE=json-rpc. */
export interface IncomingMessage {
  /** Sender plus timestamp: timestamps alone can collide across group members. */
  id: string;
  sender: string;
  timestamp: number;
  text: string;
  /** Sent from another device linked to this account; requires durable echo suppression. */
  isSelf?: boolean;
  /** The message @-mentions the bot account. */
  mentionsBot?: boolean;
  /** The message quotes something the bot account sent. */
  quotesBot?: boolean;
  /** Set when the message came from a listen-only group rather than the main group (REST id). */
  fromGroup?: string;
  quoteId?: string;
  quoteAuthor?: string;
  /** Display context only; never use quoted text as approval or authorization. */
  quoteText?: string;
}

export interface SignalTransportConfig {
  apiUrl: string;
  number: string;
  /** Either the REST group.<base64> ID or signal-cli's internal base64 ID. */
  groupId: string;
  /** Further groups whose messages are surfaced (tagged fromGroup) but never handled as requests. */
  listenGroupIds?: string[];
  botUuid?: string;
  /** Opt in only when the caller suppresses its own durable outgoing messages. */
  acceptSelfMessages?: boolean;
}

interface SignalSocket {
  addEventListener(type: string, callback: (event: Event) => void): void;
  close(): void;
}

interface TransportDependencies {
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  createSocket?: (url: string) => SignalSocket;
  onError?: (error: Error) => void;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  connectTimeoutMs?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("Invalid Signal group ID base64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("Invalid Signal group ID base64");
  }
  return decoded;
}

function internalGroupId(value: string): string {
  // The REST wrapper base64-encodes the already-base64 signal-cli ID a second time.
  // https://github.com/bbernhard/signal-cli-rest-api/blob/master/src/client/client.go
  const internal = value.startsWith("group.")
    ? decodeBase64(value.slice("group.".length)).toString("utf8")
    : value;
  const bytes = decodeBase64(internal);
  if (bytes.length !== 32) throw new Error("SIGNAL_GROUP_ID must identify a Signal v2 group (32 bytes)");
  return bytes.toString("base64");
}

/** True when two REST or internal group ids name the same group. */
export function sameGroup(a: string, b: string): boolean {
  try { return internalGroupId(a) === internalGroupId(b); } catch { return false; }
}

function validateConfig(config: SignalTransportConfig): SignalTransportConfig {
  let url: URL;
  try {
    url = new URL(config.apiUrl);
  } catch {
    throw new Error("SIGNAL_API_URL must be an explicit http:// or https:// bridge URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
    throw new Error("SIGNAL_API_URL must be an http(s) URL without credentials, query, or fragment");
  }
  if (!/^\+[1-9]\d{6,14}$/.test(config.number)) throw new Error("SIGNAL_NUMBER must be a linked account's E.164 number (+...)");
  internalGroupId(config.groupId);
  for (const extra of config.listenGroupIds ?? []) internalGroupId(extra);
  if (config.botUuid && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.botUuid)) {
    throw new Error("SIGNAL_BOT_UUID must be the linked account's UUID");
  }
  return { ...config, apiUrl: url.toString().replace(/\/+$/, "") };
}

export function loadSignalTransportConfig(env: Record<string, string | undefined> = process.env): SignalTransportConfig {
  for (const key of ["SIGNAL_API_URL", "SIGNAL_NUMBER", "SIGNAL_GROUP_ID"]) {
    if (!env[key]?.trim()) throw new Error(`${key} is required for the Signal bot`);
  }
  return validateConfig({
    apiUrl: env.SIGNAL_API_URL!.trim(),
    number: env.SIGNAL_NUMBER!.trim(),
    groupId: env.SIGNAL_GROUP_ID!.trim(),
    ...(env.SIGNAL_LISTEN_GROUP_IDS?.trim() ? { listenGroupIds: env.SIGNAL_LISTEN_GROUP_IDS.split(",").map((id) => id.trim()).filter(Boolean) } : {}),
    ...(env.SIGNAL_BOT_UUID?.trim() ? { botUuid: env.SIGNAL_BOT_UUID.trim() } : {}),
    ...(env.SIGNAL_ACCEPT_SELF_MESSAGES?.trim().toLowerCase() === "true" ? { acceptSelfMessages: true } : {}),
  });
}

/** Pure parser: excludes direct messages and other groups. Self-sync requires opt-in. */
export function parseIncomingMessage(event: unknown, config: SignalTransportConfig): IncomingMessage | null {
  const message = record(event);
  if (!message) return null;
  if (message.error) throw new Error(`Signal bridge receive error: ${String(message.error).slice(0, 500)}`);
  if (message.account && message.account !== config.number) return null;
  const envelope = record(message.envelope);
  if (!envelope) return null;
  const identities = [envelope.sourceUuid, envelope.sourceNumber, envelope.source].filter(nonempty);
  const ownSource = identities.some(identity => identity === config.number || (
    config.botUuid && String(identity).toLowerCase() === config.botUuid.toLowerCase()
  ));
  const sync = record(envelope.syncMessage);
  const isSelf = !!sync;
  if (isSelf && (!config.acceptSelfMessages || (!ownSource && message.account !== config.number))) return null;
  // Own-account ordinary data envelopes are not human input. Only the explicit
  // sent transcript from another linked device is eligible for opt-in handling.
  if (!isSelf && ownSource) return null;
  // signal-cli flattens JsonDataMessage into syncMessage.sentMessage.
  // https://github.com/AsamK/signal-cli/blob/master/src/main/java/org/asamk/signal/json/JsonSyncDataMessage.java
  const data = sync ? record(sync.sentMessage) : record(envelope.dataMessage);
  if (!data || data.editMessage) return null;
  const sender = isSelf ? config.botUuid ?? config.number
    : nonempty(envelope.sourceUuid) ?? nonempty(envelope.sourceNumber) ?? nonempty(envelope.source);
  const group = record(data.groupInfo) ?? record(data.groupV2);
  const groupId = nonempty(group?.groupId) ?? nonempty(group?.id);
  if (!groupId) return null;
  let internal: string;
  try {
    internal = internalGroupId(groupId);
  } catch {
    return null;
  }
  let fromGroup: string | undefined;
  if (internal !== internalGroupId(config.groupId)) {
    if (!(config.listenGroupIds ?? []).some((extra) => internalGroupId(extra) === internal)) return null;
    fromGroup = `group.${Buffer.from(internal).toString("base64")}`;
  }
  // Mentions arrive as U+FFFC placeholders in the text plus a mentions list.
  const text = nonempty(data.message)?.replace(/\uFFFC/g, "").trim();
  const isBot = (identity: unknown) => nonempty(identity) !== undefined && (
    identity === config.number || (!!config.botUuid && String(identity).toLowerCase() === config.botUuid.toLowerCase()));
  const mentionsBot = Array.isArray(data.mentions) && data.mentions.some((item) => {
    const mention = record(item);
    return !!mention && (isBot(mention.uuid) || isBot(mention.number));
  });
  // Sync envelopes may be delivered much later than the original human send.
  // Never substitute their envelope timestamp for approval/version ordering.
  const sentAt = timestamp(data.timestamp) ?? (isSelf ? undefined : timestamp(envelope.timestamp));
  if (!sender || !sentAt || (!text && !mentionsBot)) return null;
  const quote = record(data.quote);
  const quotedAt = timestamp(quote?.id);
  const author = nonempty(quote?.authorUuid) ?? nonempty(quote?.authorNumber) ?? nonempty(quote?.author);
  const quotesBot = !!quotedAt && (isBot(quote?.authorUuid) || isBot(quote?.authorNumber) || isBot(quote?.author));
  return {
    id: `${sender}:${sentAt}`,
    sender,
    timestamp: sentAt,
    text: text ?? "",
    ...(isSelf ? { isSelf: true } : {}),
    ...(fromGroup ? { fromGroup } : {}),
    ...(mentionsBot ? { mentionsBot: true } : {}),
    ...(quotesBot ? { quotesBot: true } : {}),
    ...(quotedAt ? { quoteId: String(quotedAt) } : {}),
    ...(author ? { quoteAuthor: author } : {}),
    ...(nonempty(quote?.text) ? { quoteText: quote!.text as string } : {}),
  };
}

export class SignalTransport {
  private readonly config: SignalTransportConfig;
  private readonly deps: Required<TransportDependencies>;
  private socket?: SignalSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private stableTimer?: ReturnType<typeof setTimeout>;
  private decoding?: Promise<void>;
  private handlers = new Set<Promise<void>>();
  private started = false;
  private stopping = false;
  private closed = false;
  private reconnectDelay: number;
  private onMessage?: (message: IncomingMessage) => void | Promise<void>;

  constructor(config: SignalTransportConfig, dependencies: TransportDependencies = {}) {
    this.config = validateConfig(config);
    this.deps = {
      fetch: dependencies.fetch ?? fetch,
      createSocket: dependencies.createSocket ?? (url => new WebSocket(url)),
      onError: dependencies.onError ?? (error => console.error("[signal-bot]", error)),
      reconnectBaseMs: dependencies.reconnectBaseMs ?? 1_000,
      reconnectMaxMs: dependencies.reconnectMaxMs ?? 30_000,
      connectTimeoutMs: dependencies.connectTimeoutMs ?? 15_000,
    };
    this.reconnectDelay = this.deps.reconnectBaseMs;
  }

  /** Starts receiving. Construction alone has no network effects. */
  connect(onMessage: (message: IncomingMessage) => void | Promise<void>): void {
    if (this.started || this.stopping) throw new Error("Signal transport can only be connected once");
    this.started = true;
    this.onMessage = onMessage;
    this.openSocket();
  }

  private report(error: unknown, context: string): void {
    const wrapped = new Error(context, { cause: error });
    try {
      this.deps.onError(wrapped);
    } catch (reportError) {
      console.error("[signal-bot] Error reporter failed", reportError, wrapped);
    }
  }

  private openSocket(): void {
    if (this.stopping) return;
    const url = new URL(`${this.config.apiUrl}/v1/receive/${encodeURIComponent(this.config.number)}`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let socket: SignalSocket;
    try {
      socket = this.deps.createSocket(url.toString());
    } catch (error) {
      this.report(error, "Could not connect to Signal bridge (MODE=json-rpc is required)");
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const drop = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.connectionTimer);
      clearTimeout(this.stableTimer);
      this.socket = undefined;
      socket.close();
      this.scheduleReconnect();
    };
    this.connectionTimer = setTimeout(() => {
      this.report(new Error("Connection timed out"), "Signal bridge did not open its receive websocket");
      drop();
    }, this.deps.connectTimeoutMs);
    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.stopping) return;
      clearTimeout(this.connectionTimer);
      // Avoid a reconnect storm if the bridge repeatedly opens and drops immediately.
      this.stableTimer = setTimeout(() => { this.reconnectDelay = this.deps.reconnectBaseMs; }, 30_000);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.stopping) return;
      this.report(new Error("Receive websocket closed"), "Signal bridge disconnected; reconnecting");
      drop();
    });
    socket.addEventListener("error", event => {
      if (this.socket !== socket || this.stopping) return;
      this.report(event, "Signal bridge websocket failed; reconnecting");
      drop();
    });
    socket.addEventListener("message", event => {
      if (this.socket !== socket || this.stopping) return;
      const data: unknown = (event as MessageEvent).data;
      // Signal sends JSON text frames. Invoke the callback in the receive event
      // so its inbox write is durable even while an earlier LLM call is running.
      const raw = typeof data === "string" ? data
        : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : undefined;
      if (!this.decoding && raw !== undefined) {
        this.acceptFrame(raw);
        return;
      }
      // Blob decoding is asynchronous; serialize decoding only, never handlers,
      // to preserve frame order if a websocket implementation sends binary data.
      const decoded = (this.decoding ?? Promise.resolve()).then(async () => {
        const text = raw ?? (data instanceof Blob ? await data.text() : undefined);
        if (text === undefined) throw new Error("Unsupported Signal websocket message format");
        this.acceptFrame(text);
      }).catch(error => this.report(error, "Signal frame decoding failed"));
      this.decoding = decoded;
      void decoded.then(() => { if (this.decoding === decoded) this.decoding = undefined; });
    });
  }

  private acceptFrame(raw: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (error) { this.report(error, "Signal frame parsing failed"); return; }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
      try {
        const message = parseIncomingMessage(item, this.config);
        if (!message) continue;
        // The engine persists receipt synchronously and owns serial effects.
        // Tracking its promise here is solely for graceful shutdown.
        const result = this.onMessage!(message);
        if (result) {
          const tracked = Promise.resolve(result).catch(error => this.report(error, "Signal message handling failed"));
          this.handlers.add(tracked);
          void tracked.then(() => this.handlers.delete(tracked));
        }
      } catch (error) {
        this.report(error, "Signal message handling failed");
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    const delay = Math.min(this.reconnectDelay, this.deps.reconnectMaxMs);
    this.reconnectDelay = Math.min(delay * 2, this.deps.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
  }

  /** Returns the actual sent timestamp used by Signal quotes and conversation routing.
   * `groupId` (REST or internal) sends to another group instead of the main one. */
  async send(text: string, quote?: IncomingMessage, groupId?: string): Promise<string> {
    if (this.closed) throw new Error("Signal transport is closed");
    if (!text.trim()) throw new Error("Cannot send an empty Signal message");
    // A single response must have one routable timestamp. Do not truncate drafts or
    // split them into separately approvable fragments; callers should keep replies short.
    if (text.length > 6_000) throw new Error("Signal reply exceeds 6000 characters; shorten the discussion response");
    const recipient = `group.${Buffer.from(internalGroupId(groupId ?? this.config.groupId)).toString("base64")}`;
    const response = await this.deps.fetch(`${this.config.apiUrl}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: this.config.number,
        recipients: [recipient],
        message: text,
        text_mode: "normal",
        ...(quote ? {
          quote_timestamp: quote.timestamp,
          quote_author: quote.sender,
          quote_message: quote.text,
        } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Signal send failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    const parsed: unknown = JSON.parse(body);
    const results = Array.isArray(parsed) ? parsed : [parsed];
    const result = record(results[0]);
    if (results.length !== 1 || !result) throw new Error("Signal send returned an unexpected response");
    const errors = record(result.errors);
    if (result.error || (result.errors && (!errors || Object.values(errors).some(value => (
      Array.isArray(value) ? value.length > 0 : Boolean(value)
    ))))) throw new Error(`Signal send reported delivery errors: ${JSON.stringify(result.errors ?? result.error).slice(0, 500)}`);
    if (!timestamp(result.timestamp)) throw new Error("Signal send returned no valid timestamp; delivery is unconfirmed");
    return String(result.timestamp);
  }

  /** Stops receiving and reconnecting, then lets already accepted messages finish. */
  async close(additionalWork?: Promise<void>): Promise<void> {
    this.stopping = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimer);
    clearTimeout(this.stableTimer);
    this.socket?.close();
    this.socket = undefined;
    await this.decoding;
    await Promise.all([...this.handlers, ...(additionalWork ? [additionalWork] : [])]);
    this.closed = true;
  }
}
