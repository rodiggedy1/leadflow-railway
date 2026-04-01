/**
 * Deepgram Streaming WebSocket Proxy (SDK v5)
 *
 * Flow:
 *   Browser mic (raw PCM 16kHz mono) → WS /api/deepgram-stream → Deepgram Live API
 *   Deepgram transcript events → WS back to browser as JSON
 *
 * Messages sent to browser:
 *   { type: "ready" }
 *   { type: "transcript", text: string, isFinal: boolean, speaker: number }
 *   { type: "utterance_end" }
 *   { type: "error", message: string }
 *   { type: "closed" }
 */
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { DeepgramClient } from "@deepgram/sdk";

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY!;

// Local type definitions matching Deepgram SDK v5 response shapes
interface DgWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

interface DgAlternative {
  transcript: string;
  confidence: number;
  words: DgWord[];
}

interface DgResultsMessage {
  type: "Results";
  channel_index: number[];
  duration: number;
  start: number;
  is_final?: boolean;
  speech_final?: boolean;
  channel: {
    alternatives: DgAlternative[];
  };
}

interface DgUtteranceEndMessage {
  type: "UtteranceEnd";
  channel: number[];
  last_word_end: number;
}

type DgMessage = DgResultsMessage | DgUtteranceEndMessage | { type: string };

export function registerDeepgramStreamRoute(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/deepgram-stream" });

  wss.on("connection", (browserWs: WebSocket) => {
    console.log("[Deepgram] Browser connected");

    let dgSocket: Awaited<ReturnType<typeof openDeepgramConnection>> | null = null;
    let isReady = false;
    const audioQueue: Buffer[] = [];

    function send(data: object) {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify(data));
      }
    }

    async function openDeepgramConnection() {
      const client = new DeepgramClient({ apiKey: DEEPGRAM_API_KEY });
      const conn = await client.listen.v1.connect({
        // Authorization is required by the type but ignored by the SDK when apiKey is in options
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        model: "nova-2",
        language: "en-US",
        smart_format: "true",
        diarize: "true",
        punctuate: "true",
        interim_results: "true",
        utterance_end_ms: "1000",
        vad_events: "true",
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
      });

      conn.on("open", () => {
        console.log("[Deepgram] Live connection opened");
        isReady = true;
        for (const chunk of audioQueue) {
          conn.sendMedia(chunk);
        }
        audioQueue.length = 0;
        send({ type: "ready" });
      });

      conn.on("message", (data: unknown) => {
        const msg = data as DgMessage;

        if (msg.type === "Results") {
          const result = msg as DgResultsMessage;
          const alt = result.channel?.alternatives?.[0];
          if (!alt?.transcript) return;

          const isFinal = result.is_final ?? false;
          const words = alt.words ?? [];

          // Determine dominant speaker from word-level diarization
          let speaker = 0;
          if (words.length > 0) {
            const counts: Record<number, number> = {};
            for (const w of words) {
              const s = w.speaker ?? 0;
              counts[s] = (counts[s] ?? 0) + 1;
            }
            speaker = parseInt(
              Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
            );
          }

          send({ type: "transcript", text: alt.transcript, isFinal, speaker });
        }

        if (msg.type === "UtteranceEnd") {
          send({ type: "utterance_end" });
        }
      });

      conn.on("error", (err: Error) => {
        console.error("[Deepgram] Error:", err);
        send({ type: "error", message: err.message });
      });

      conn.on("close", () => {
        console.log("[Deepgram] Live connection closed");
        send({ type: "closed" });
      });

      conn.connect();
      await conn.waitForOpen();
      return conn;
    }

    // Open Deepgram connection
    openDeepgramConnection()
      .then(conn => { dgSocket = conn; })
      .catch(err => {
        console.error("[Deepgram] Failed to open connection:", err);
        send({ type: "error", message: "Failed to connect to Deepgram" });
        browserWs.close();
      });

    // Forward audio chunks from browser to Deepgram
    browserWs.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isBinary) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (!isReady || !dgSocket) {
        audioQueue.push(buf);
      } else {
        dgSocket.sendMedia(buf);
      }
    });

    // Clean up when browser disconnects
    browserWs.on("close", () => {
      console.log("[Deepgram] Browser disconnected");
      try { dgSocket?.close(); } catch { /* ignore */ }
    });

    browserWs.on("error", (err: Error) => {
      console.error("[Deepgram] Browser WS error:", err);
      try { dgSocket?.close(); } catch { /* ignore */ }
    });
  });

  console.log("[Deepgram] WebSocket proxy registered at /api/deepgram-stream");
}
