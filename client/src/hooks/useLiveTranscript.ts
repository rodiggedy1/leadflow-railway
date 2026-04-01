/**
 * useLiveTranscript — Streams mic audio to the Deepgram WebSocket proxy and
 * returns real-time transcript events.
 *
 * Usage:
 *   const { isRecording, start, stop, lastTranscript, error } = useLiveTranscript({
 *     onFinalTranscript: (text, speaker) => { ... },
 *     onUtteranceEnd: () => { ... },
 *   });
 *
 * Audio pipeline:
 *   Mic → AudioWorklet (PCM 16kHz mono) → WebSocket /api/deepgram-stream → Deepgram
 *   Deepgram → WebSocket → { type: "transcript", text, isFinal, speaker }
 *
 * Speaker 0 = first speaker (usually customer), Speaker 1 = agent
 * We treat speaker 0 as "customer" for the call assist flow.
 */
import { useCallback, useRef, useState } from "react";

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  speaker: number;
}

interface UseLiveTranscriptOptions {
  /** Called when a final transcript segment arrives */
  onFinalTranscript?: (text: string, speaker: number) => void;
  /** Called when Deepgram signals utterance end */
  onUtteranceEnd?: () => void;
  /** Called on any error */
  onError?: (message: string) => void;
}

export type LiveTranscriptStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "stopping"
  | "error";

export function useLiveTranscript(opts: UseLiveTranscriptOptions = {}) {
  const [status, setStatus] = useState<LiveTranscriptStatus>("idle");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const stop = useCallback(() => {
    setStatus("stopping");

    // Stop the ScriptProcessor
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Stop the AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    // Stop mic tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }

    // Close the WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setInterimText("");
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (status !== "idle") return;

    setError(null);
    setStatus("connecting");

    try {
      // 1. Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. Open WebSocket to our server proxy
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProtocol}//${window.location.host}/api/deepgram-stream`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.type === "ready") {
            setStatus("recording");
          }

          if (msg.type === "transcript") {
            const { text, isFinal, speaker } = msg as TranscriptEvent;
            if (isFinal) {
              setInterimText("");
              opts.onFinalTranscript?.(text, speaker);
            } else {
              setInterimText(text);
            }
          }

          if (msg.type === "utterance_end") {
            opts.onUtteranceEnd?.();
          }

          if (msg.type === "error") {
            const errMsg = (msg as { type: string; message: string }).message;
            setError(errMsg);
            opts.onError?.(errMsg);
            stop();
          }

          if (msg.type === "closed") {
            setStatus("idle");
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        const msg = "WebSocket connection failed";
        setError(msg);
        opts.onError?.(msg);
        setStatus("error");
        stop();
      };

      ws.onclose = () => {
        setStatus(prev => prev === "recording" ? "idle" : prev);
      };

      // 3. Wait for WS to open, then start audio pipeline
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        setTimeout(() => reject(new Error("WebSocket connection timed out")), 10_000);
      });

      // 4. Set up AudioContext + ScriptProcessor to capture PCM
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessorNode: 4096 samples, 1 input channel, 1 output channel
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        // Convert Float32 PCM → Int16 PCM
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start recording";
      setError(msg);
      opts.onError?.(msg);
      setStatus("error");
      stop();
    }
  }, [status, stop, opts]);

  return {
    status,
    isRecording: status === "recording",
    isConnecting: status === "connecting",
    interimText,
    error,
    start,
    stop,
  };
}
