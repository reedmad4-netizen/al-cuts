/**
 * Zero-API-Key Real-Time Live Chat Connectors
 * - Twitch: Official anonymous read-only IRC over WebSocket (justinfan)
 * - YouTube Live: Keyless InnerTube live_chat continuation polling
 * - Kick: Public Pusher WebSocket chatroom subscription
 */
import WebSocket from "ws";

const WEB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const KICK_PUSHER_URL =
  "wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.4.0&flash=false";

export interface IncomingLiveChat {
  author: string;
  message: string;
  rateOnly?: boolean;
}

export interface LiveChatHandle {
  source: string;
  isConnected: () => boolean;
  stop: () => void;
}

/**
 * 1. Twitch Anonymous Read-Only IRC WebSocket (0 API keys, 0 OAuth tokens)
 */
export function connectTwitchLiveChat(
  channelLogin: string,
  onMessage: (msg: IncomingLiveChat) => void
): LiveChatHandle {
  const login = channelLogin.trim().replace(/^@/, "").toLowerCase();
  let ws: WebSocket | null = null;
  let stopped = false;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Throttle huge 50k-viewer chats slightly for DB writes while preserving every spike signal
  let lastDbEmitMs = 0;

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");

      ws.on("open", () => {
        if (stopped || !ws) return;
        const anonNick = `justinfan${Math.floor(10000 + Math.random() * 89999)}`;
        ws.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
        ws.send("PASS SCHMOOPIIE");
        ws.send(`NICK ${anonNick}`);
        ws.send(`JOIN #${login}`);
        connected = true;
      });

      ws.on("message", (raw) => {
        if (stopped) return;
        const chunk = raw.toString();
        const lines = chunk.split("\r\n");
        for (const line of lines) {
          if (!line) continue;
          if (line.startsWith("PING")) {
            try {
              ws?.send("PONG :tmi.twitch.tv");
            } catch {
              // ignore
            }
            continue;
          }
          const privIdx = line.indexOf(` PRIVMSG #${login} :`);
          if (privIdx === -1) continue;
          const text = line
            .slice(privIdx + ` PRIVMSG #${login} :`.length)
            .replace(/^\u0001ACTION\s+|\u0001$/g, "")
            .trim();
          if (!text) continue;

          const dnMatch = line.match(/display-name=([^;]*)/);
          const nickMatch = line.match(/:([^!]+)!/);
          const author =
            (dnMatch?.[1] && dnMatch[1].trim()) ||
            nickMatch?.[1] ||
            "twitch_viewer";

          // Always count velocity for hype spikes; throttle DB persistence on 50k+ raids
          const now = Date.now();
          const skipDb = now - lastDbEmitMs < 90;
          if (!skipDb) lastDbEmitMs = now;

          onMessage({
            author: author.slice(0, 40),
            message: text.slice(0, 280),
            rateOnly: skipDb,
          });
        }
      });

      ws.on("close", () => {
        connected = false;
        if (!stopped) {
          reconnectTimer = setTimeout(connect, 4000);
        }
      });

      ws.on("error", () => {
        connected = false;
        try {
          ws?.close();
        } catch {
          // ignore
        }
      });
    } catch {
      connected = false;
      if (!stopped) {
        reconnectTimer = setTimeout(connect, 5000);
      }
    }
  };

  connect();

  return {
    source: `Twitch IRC (#${login})`,
    isConnected: () => connected,
    stop: () => {
      stopped = true;
      connected = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}

/**
 * 2. YouTube Live Chat Keyless Continuation Poller (0 API keys)
 */
export function connectYoutubeLiveChat(
  videoId: string,
  onMessage: (msg: IncomingLiveChat) => void
): LiveChatHandle {
  let stopped = false;
  let connected = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let apiKey = "";
  let continuation = "";
  let isFirstBatch = true;
  const seenIds = new Set<string>();

  const bootstrap = async () => {
    if (stopped) return;
    try {
      const res = await fetch(
        `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        {
          headers: {
            "User-Agent": WEB_UA,
            "Accept-Language": "en-US,en;q=0.9",
            Cookie: "CONSENT=YES+cb.20210328-17-p0.en+FX+667",
          },
          signal: AbortSignal.timeout(9000),
        }
      );
      if (!res.ok) return;
      const html = await res.text();
      apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || "";
      continuation =
        html.match(
          /"liveChatRenderer":[\s\S]{0,4000}?"continuation":"([^"]+)"/
        )?.[1] || "";
      if (apiKey && continuation && !stopped) {
        connected = true;
        void poll();
      }
    } catch {
      connected = false;
    }
  };

  const poll = async () => {
    if (stopped || !apiKey || !continuation) return;
    let nextDelayMs = 3500;
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(
          apiKey
        )}&prettyPrint=false`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": WEB_UA,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "WEB",
                clientVersion: "2.20260101.01.00",
                hl: "en",
                gl: "US",
              },
            },
            continuation,
          }),
          signal: AbortSignal.timeout(9000),
        }
      );

      if (res.ok) {
        connected = true;
        const json = (await res.json()) as {
          continuationContents?: {
            liveChatContinuation?: {
              continuations?: Array<{
                invalidationContinuationData?: {
                  continuation?: string;
                  timeoutMs?: number;
                };
                timedContinuationData?: {
                  continuation?: string;
                  timeoutMs?: number;
                };
                reloadContinuationData?: { continuation?: string };
              }>;
              actions?: Array<{
                addChatItemAction?: {
                  item?: {
                    liveChatTextMessageRenderer?: {
                      id?: string;
                      authorName?: { simpleText?: string };
                      message?: {
                        runs?: Array<{
                          text?: string;
                          emoji?: { shortcuts?: string[] };
                        }>;
                      };
                    };
                  };
                };
              }>;
            };
          };
        };

        const lc = json.continuationContents?.liveChatContinuation;
        const c0 = lc?.continuations?.[0];
        const nextCont =
          c0?.invalidationContinuationData?.continuation ||
          c0?.timedContinuationData?.continuation ||
          c0?.reloadContinuationData?.continuation;
        if (nextCont) continuation = nextCont;

        const suggestedMs =
          c0?.invalidationContinuationData?.timeoutMs ||
          c0?.timedContinuationData?.timeoutMs;
        if (suggestedMs) {
          nextDelayMs = Math.max(2500, Math.min(6000, suggestedMs));
        }

        const actions = lc?.actions || [];
        // On first batch, emit only the last 6 recent messages so baseline isn't artificially spiked
        const slice = isFirstBatch ? actions.slice(-6) : actions;
        isFirstBatch = false;

        for (const act of slice) {
          const r = act.addChatItemAction?.item?.liveChatTextMessageRenderer;
          if (!r) continue;
          const id = r.id || "";
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);

          const author = r.authorName?.simpleText || "yt_viewer";
          const text = (r.message?.runs || [])
            .map((run) => run.text || run.emoji?.shortcuts?.[0] || "")
            .join("")
            .trim();
          if (!text) continue;
          onMessage({
            author: author.slice(0, 40),
            message: text.slice(0, 280),
          });
        }

        if (seenIds.size > 400) {
          const arr = Array.from(seenIds).slice(-200);
          seenIds.clear();
          arr.forEach((x) => seenIds.add(x));
        }
      }
    } catch {
      nextDelayMs = 5000;
    }

    if (!stopped) {
      timer = setTimeout(() => void poll(), nextDelayMs);
    }
  };

  void bootstrap();

  return {
    source: "YouTube Live Chat",
    isConnected: () => connected,
    stop: () => {
      stopped = true;
      connected = false;
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * 3. Kick Public Pusher WebSocket Live Chat (0 API keys)
 */
export function connectKickLiveChat(
  chatroomId: number,
  slug: string,
  onMessage: (msg: IncomingLiveChat) => void
): LiveChatHandle {
  let ws: WebSocket | null = null;
  let stopped = false;
  let connected = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped || !chatroomId) return;
    try {
      ws = new WebSocket(KICK_PUSHER_URL);

      ws.on("message", (raw) => {
        if (stopped) return;
        try {
          const pkt = JSON.parse(raw.toString()) as {
            event?: string;
            data?: string;
          };
          if (pkt.event === "pusher:connection_established") {
            ws?.send(
              JSON.stringify({
                event: "pusher:subscribe",
                data: { auth: "", channel: `chatrooms.${chatroomId}.v2` },
              })
            );
            connected = true;
          } else if (pkt.event === "pusher:ping") {
            ws?.send(JSON.stringify({ event: "pusher:pong", data: {} }));
          } else if (
            pkt.event === "App\\Events\\ChatMessageEvent" &&
            pkt.data
          ) {
            const msg = JSON.parse(pkt.data) as {
              content?: string;
              sender?: { username?: string };
            };
            const text = (msg.content || "")
              .replace(/\[emote:\d+:([^\]]+)\]/g, "$1")
              .trim();
            if (text) {
              onMessage({
                author: (msg.sender?.username || "kick_viewer").slice(0, 40),
                message: text.slice(0, 280),
              });
            }
          }
        } catch {
          // ignore malformed event
        }
      });

      ws.on("close", () => {
        connected = false;
        if (!stopped) reconnectTimer = setTimeout(connect, 4500);
      });

      ws.on("error", () => {
        connected = false;
        try {
          ws?.close();
        } catch {
          // ignore
        }
      });
    } catch {
      connected = false;
    }
  };

  connect();

  return {
    source: `Kick Live Chat (#${slug})`,
    isConnected: () => connected,
    stop: () => {
      stopped = true;
      connected = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
    },
  };
}
