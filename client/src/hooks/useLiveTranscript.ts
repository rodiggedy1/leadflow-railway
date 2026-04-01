/**
 * useLiveTranscript — Streams audio to the Deepgram WebSocket proxy and
 * returns real-time transcript events.
 *
 * Supports three audio source modes:
 *   "mic"    — microphone only (getUserMedia)
 *   "system" — tab/system audio only (getDisplayMedia with systemAudio)
 *   "both"   — mic + system audio mixed together in an AudioContext
 *
 * System audio requires Chrome/Edge desktop. Firefox and Safari do not
 * support the audio track from getDisplayMedia.
 *
 * Audio pipeline:
 *   Source(s) → AudioContext (mixed to mono 16kHz) → ScriptProcessor (PCM Int16) → WebSocket
 *   WebSocket → Deepgram → { type: "transcript", text, isFinal, speaker }
 *
 * Speaker diarization:
 *   Speaker 0 = first speaker detected (usually customer on inbound calls)
 *   Speaker 1 = second speaker (usually agent)
 */
import { useCallback, useRef, useState } from "react";

export type AudioSourceMode = "mic" | "system" | "both";

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

/** Returns true if this browser supports getDisplayMedia with system audio */
export function supportsSystemAudio(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Chrome and Edge on desktop support it; Firefox/Safari do not
  const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\//.test(ua);
  return (isChrome || isEdge) && !/Mobile/.test(ua);
}

export function useLiveTranscript(opts: UseLiveTranscriptOptions = {}) {
  const [status, setStatus] = useState<LiveTranscriptStatus>("idle");
  const [interimText, setInterimText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  // Keep track of all MediaStream tracks so we can stop them on cleanup
  const tracksRef = useRef<MediaStreamTrack[]>([]);

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

    // Stop all captured tracks
    for (const track of tracksRef.current) {
      track.stop();
    }
    tracksRef.current = [];

    // Close the WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setInterimText("");
    setStatus("idle");
  }, []);

  const start = useCallback(async (mode: AudioSourceMode = "mic") => {
    if (status !== "idle") return;

    setError(null);
    setStatus("connecting");

    try {
      // ── 1. Gather audio streams based on mode ─────────────────────────────

      let micStream: MediaStream | null = null;
      let sysStream: MediaStream | null = null;

      if (mode === "mic" || mode === "both") {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        for (const t of micStream.getTracks()) tracksRef.current.push(t);
      }

      if (mode === "system" || mode === "both") {
        // getDisplayMedia requires video:true even when we only want audio.
        // We immediately stop the video track after getting the stream.
        try {
          sysStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            // @ts-expect-error — systemAudio is a Chrome/Edge extension not in all TS typings
            audio: { systemAudio: "include" },
          });
        } catch (err) {
          // User cancelled the picker or permission denied
          const msg = err instanceof Error ? err.message : "Screen share cancelled";
          // Stop any mic tracks we already captured
          for (const t of tracksRef.current) t.stop();
          tracksRef.current = [];
          setError(msg);
          opts.onError?.(msg);
          setStatus("error");
          return;
        }

        // Stop the video track immediately — we only want audio
        for (const t of sysStream.getVideoTracks()) t.stop();

        const audioTracks = sysStream.getAudioTracks();
        if (audioTracks.length === 0) {
          // User didn't check "Share tab audio" in the Chrome dialog
          for (const t of tracksRef.current) t.stop();
          tracksRef.current = [];
          const msg =
            'No system audio captured. In Chrome\'s sharing dialog, check the "Share tab audio" checkbox and try again.';
          setError(msg);
          opts.onError?.(msg);
          setStatus("error");
          return;
        }

        for (const t of audioTracks) tracksRef.current.push(t);

        // Listen for user stopping the share via Chrome's toolbar button
        audioTracks[0].addEventListener("ended", () => {
          stop();
        });
      }

      // ── 2. Open WebSocket to our server proxy ─────────────────────────────

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
            setStatus(prev => prev === "recording" ? "idle" : prev);
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

      // Wait for WS to open
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        setTimeout(() => reject(new Error("WebSocket connection timed out")), 10_000);
      });

      // ── 3. Set up AudioContext to mix sources and capture PCM ─────────────

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;

      // Create a destination node that all sources feed into
      const mixDest = audioCtx.createMediaStreamDestination();

      if (micStream) {
        const micSource = audioCtx.createMediaStreamSource(micStream);
        micSource.connect(mixDest);
      }

      if (sysStream) {
        // Re-build a MediaStream from just the audio tracks
        const sysAudioStream = new MediaStream(sysStream.getAudioTracks());
        const sysSource = audioCtx.createMediaStreamSource(sysAudioStream);
        sysSource.connect(mixDest);
      }

      // ScriptProcessorNode: 4096 samples, 1 input channel, 1 output channel
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const mixSource = audioCtx.createMediaStreamSource(mixDest.stream);
      mixSource.connect(processor);
      processor.connect(audioCtx.destination);

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
    supportsSystemAudio: supportsSystemAudio(),
  };
}
