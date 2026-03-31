/**
 * AI Interview — /interview/:candidateId
 *
 * Flow:
 *  1. Page loads → fetches candidate config
 *  2. Shows "Ready" screen with candidate name + Start button
 *  3. User clicks Start → requests mic + camera → VAPI connects
 *  4. Active: waveform visualizer + camera feed + mute/end controls
 *  5. Call ends → uploads camera recording to S3 → "Done" screen
 *
 * No auto-start: browser mic permission requires a user gesture.
 * alreadyInterviewed is intentionally ignored so retesting works.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "wouter";
import Vapi from "@vapi-ai/web";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, PhoneOff, Loader2, CheckCircle2, AlertCircle, Video } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type InterviewStatus =
  | "loading"     // fetching config from server
  | "ready"       // config loaded, waiting for user to click Start
  | "connecting"  // requesting mic/camera + VAPI connecting
  | "active"      // call in progress
  | "ending"      // call ended, uploading video
  | "done"        // all done
  | "error";      // something went wrong

// ── Inline VAPI assistant config ──────────────────────────────────────────────

function buildAssistantConfig(candidateName: string) {
  const firstName = candidateName.split(" ")[0] ?? candidateName;
  return {
    name: "Hiring Interview Assistant",
    voice: {
      provider: "playht" as const,
      voiceId: "jennifer" as const,
    },
    model: {
      provider: "openai" as const,
      model: "gpt-4o" as const,
      messages: [
        {
          role: "system" as const,
          content: `You are a friendly, professional hiring interviewer for Maids in Black, a premium residential cleaning company in Washington DC. You are conducting a short screening interview with ${firstName}.

Your goal is to assess their fit for a cleaning professional role. Ask the following 4 questions, one at a time, and listen carefully to each answer before moving on:

1. "Can you tell me a little about yourself and your cleaning experience?"
2. "What does excellent customer service mean to you when you're working in someone's home?"
3. "How do you handle situations where a client is unhappy with your work?"
4. "What's your availability like, and are you comfortable working independently?"

After all 4 questions, thank them warmly and let them know the team will be in touch within 2 business days. Keep the conversation natural and encouraging. Total interview should take 5-8 minutes.

Start by greeting ${firstName} warmly and asking the first question.`,
        },
      ],
    },
    firstMessage: `Hi ${firstName}! Welcome to your interview with Maids in Black. I'm your AI interviewer today. This will be a short, friendly conversation — about 5 to 8 minutes. Ready to get started?`,
    endCallMessage: `Thank you so much for your time today, ${firstName}. Our hiring team will review your application and be in touch within 2 business days. Have a great day!`,
    endCallPhrases: ["goodbye", "bye", "that's all", "thank you goodbye"],
  };
}

// ── Waveform Visualizer ───────────────────────────────────────────────────────

function WaveformVisualizer({
  isActive,
  isSpeaking,
}: {
  isActive: boolean;
  isSpeaking: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const BAR_COUNT = 48;

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const barW = W / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        let barH: number;
        const t = Date.now() / 1000;
        if (isSpeaking) {
          // Energetic wave when AI speaking
          barH =
            (Math.sin(t * 8 + i * 0.4) * 0.4 +
              Math.sin(t * 5 + i * 0.7) * 0.3 +
              0.3) *
            H *
            0.85;
        } else if (isActive) {
          // Gentle idle pulse when listening
          barH =
            (Math.sin(t * 1.5 + i * 0.3) * 0.5 + 0.5) * H * 0.12 + H * 0.04;
        } else {
          barH = H * 0.03;
        }

        const x = i * barW;
        const y = H / 2 - barH / 2;

        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(
          0,
          isSpeaking ? "rgba(99,102,241,0.95)" : "rgba(99,102,241,0.35)"
        );
        grad.addColorStop(
          1,
          isSpeaking ? "rgba(168,85,247,0.95)" : "rgba(168,85,247,0.35)"
        );

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x + 1.5, y, barW - 3, Math.max(barH, 2), 3);
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, isSpeaking]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={100}
      className="w-full max-w-lg"
      style={{ display: "block" }}
    />
  );
}

// ── Camera Feed ───────────────────────────────────────────────────────────────

function CameraFeed({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{
        width: "100%",
        maxWidth: 400,
        aspectRatio: "4/3",
        backgroundColor: "#1e293b",
        border: "2px solid rgba(99,102,241,0.25)",
        boxShadow: "0 0 32px rgba(99,102,241,0.12)",
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3">
          <Video size={32} style={{ color: "rgba(255,255,255,0.2)" }} />
          <span className="text-white/30 text-sm">Camera starting…</span>
        </div>
      )}

      {stream && (
        <div
          className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}
        >
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-xs font-semibold tracking-wide">REC</span>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AIInterview() {
  const params = useParams<{ candidateId: string }>();
  const candidateId = parseInt(params.candidateId ?? "0", 10);

  const [status, setStatus] = useState<InterviewStatus>("loading");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [uploadProgress, setUploadProgress] = useState<string>("");

  const vapiRef = useRef<Vapi | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // Session ID for chunk uploads — generated once per component mount
  const sessionIdRef = useRef<string>(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const chunkIndexRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>("video/webm");
  // Mirror status in a ref so the cleanup useEffect can read current value
  // without being re-registered every time status changes (avoids StrictMode issues)
  const statusRef = useRef<InterviewStatus>("loading");
  // Keep statusRef in sync with status state
  useEffect(() => { statusRef.current = status; }, [status]);
  // Ref to always-latest stopRecordingAndUpload — prevents stale closure in call-end handler
  const stopRecordingAndUploadRef = useRef<() => Promise<void>>(async () => {});

  // ── tRPC ──────────────────────────────────────────────────────────────────

  const configQuery = trpc.hiring.getInterviewConfig.useQuery(
    { candidateId },
    { enabled: candidateId > 0, retry: 1 }
  );

  const saveCallId = trpc.hiring.saveInterviewCallId.useMutation();

  // Refs for values used inside closures — avoids stale closures entirely
  const candidateIdRef = useRef<number>(candidateId);
  useEffect(() => { candidateIdRef.current = candidateId; }, [candidateId]);

  // When config loads, move to "ready"
  useEffect(() => {
    if (configQuery.data && status === "loading") {
      setStatus("ready");
    }
    if (configQuery.error && status === "loading") {
      setStatus("error");
      setErrorMsg("Could not load interview. Please check the link and try again.");
    }
  }, [configQuery.data, configQuery.error, status]);

  // ── Camera helpers ────────────────────────────────────────────────────────

  const startCamera = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraStream(stream);
      return stream;
    } catch {
      return null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
  }, []);

  // ── MediaRecorder (chunk-upload approach) ────────────────────────────────
  //
  // Each 5-second chunk is uploaded to S3 immediately via /api/interview/chunk.
  // This means the video is saved incrementally — even if the browser closes
  // mid-interview, all recorded chunks are already on S3.
  // At call-end, /api/interview/finalize concatenates the chunks and saves the
  // final URL to the candidate record.

  const uploadChunk = useCallback(async (chunkBlob: Blob, index: number, mimeType: string) => {
    const sessionId = sessionIdRef.current;
    try {
      console.log(`[Interview] Uploading chunk index=${index} size=${chunkBlob.size} session=${sessionId}`);
      const res = await fetch("/api/interview/chunk", {
        method: "POST",
        headers: {
          "Content-Type": mimeType,
          "X-Session-Id": sessionId,
          "X-Chunk-Index": String(index),
        },
        body: chunkBlob,
        credentials: "include",
      });
      if (!res.ok) {
        console.error(`[Interview] Chunk ${index} upload failed: ${res.status}`);
      } else {
        console.log(`[Interview] Chunk ${index} uploaded OK`);
      }
    } catch (err) {
      console.error(`[Interview] Chunk ${index} upload error:`, err);
    }
  }, []);

  const startRecording = useCallback((stream: MediaStream) => {
    if (!stream || stream.getVideoTracks().length === 0) return;
    // Reset chunk index for this session
    chunkIndexRef.current = 0;
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "video/mp4";
    mimeTypeRef.current = mimeType;
    try {
      const mr = new MediaRecorder(stream, { mimeType });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const idx = chunkIndexRef.current++;
          // Upload immediately — fire-and-forget with keepalive
          uploadChunk(e.data, idx, mimeType);
        }
      };
      // Collect chunks every 5 seconds
      mr.start(5000);
      mediaRecorderRef.current = mr;
      console.log(`[Interview] Recording started — session=${sessionIdRef.current} mimeType=${mimeType}`);
    } catch (err) {
      console.warn("[Interview] MediaRecorder init failed:", err);
    }
  }, [uploadChunk]);

  // stopRecordingAndUpload — stops the recorder, waits for the final ondataavailable
  // chunk to be uploaded, then calls /api/interview/finalize to assemble and save.
  const stopRecordingAndUpload = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") {
      console.log("[Interview] stopRecordingAndUpload: recorder not active, skipping");
      return;
    }
    const sessionId = sessionIdRef.current;
    const mimeType = mimeTypeRef.current;
    const cid = candidateIdRef.current;
    console.log(`[Interview] Stopping recorder — session=${sessionId} candidateId=${cid}`);

    // Wait for the final chunk to be delivered via ondataavailable
    await new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
      mr.stop();
    });

    // Give the last chunk upload a moment to complete (keepalive fetch)
    await new Promise((r) => setTimeout(r, 500));

    if (cid <= 0) {
      console.warn("[Interview] Invalid candidateId, skipping finalize");
      return;
    }

    try {
      setUploadProgress("Saving your interview video…");
      console.log(`[Interview] Calling finalize — session=${sessionId} candidateId=${cid}`);
      const res = await fetch("/api/interview/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, candidateId: cid, mimeType }),
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text();
        console.error(`[Interview] Finalize failed: ${res.status} ${txt}`);
      } else {
        const { url } = await res.json() as { url: string };
        console.log("[Interview] Finalize succeeded, URL:", url);
      }
      setUploadProgress("");
    } catch (err) {
      console.error("[Interview] Finalize error:", err);
      setUploadProgress("");
    }
  }, [uploadChunk]);

  // Keep the ref in sync so call-end handler always calls the latest version
  useEffect(() => {
    stopRecordingAndUploadRef.current = stopRecordingAndUpload;
  }, [stopRecordingAndUpload]);

  // ── Start interview (triggered by button click) ───────────────────────────

  const startInterview = useCallback(async () => {
    const config = configQuery.data;
    if (!config) return;

    setStatus("connecting");

    // 1. Request mic permission (required for VAPI)
    try {
      const micTest = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTest.getTracks().forEach((t) => t.stop());
    } catch {
      setStatus("error");
      setErrorMsg(
        "Microphone access is required for the interview. Please allow microphone access in your browser settings and refresh the page."
      );
      return;
    }

    // 2. Start camera (optional — continue without it if denied)
    const videoStream = await startCamera();
    if (videoStream) {
      startRecording(videoStream);
    }

    // 3. Launch VAPI
    try {
      const vapi = new Vapi(config.vapiPublicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        console.log("[VAPI] ✅ call-start fired");
        setStatus("active");
        timerRef.current = setInterval(
          () => setCallDuration((d) => d + 1),
          1000
        );
      });

      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));

      vapi.on("call-start-progress", (event: unknown) => {
        console.log("[VAPI] call-start-progress:", JSON.stringify(event));
      });

      vapi.on("call-end", async () => {
        console.log("[VAPI] ⚠️ call-end fired, statusRef.current =", statusRef.current);
        setIsSpeaking(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setStatus("ending");

        if (callIdRef.current && candidateId > 0) {
          saveCallId.mutate({ candidateId, callId: callIdRef.current });
        }

        // Use ref to get the latest version — avoids stale closure that would
        // see mediaRecorderRef.current = null and skip the upload entirely
        await stopRecordingAndUploadRef.current();
        stopCamera();
        setStatus("done");
      });

      vapi.on("error", (err: unknown) => {
        console.error("[VAPI] ❌ error event:", JSON.stringify(err));
        const errObj = err as Record<string, unknown>;
        const errType = String(errObj?.type ?? "");
        const errMsg = String(errObj?.message ?? "");
        let msg =
          "Connection error. Please refresh the page and try again.";
        if (
          errType.includes("mic") ||
          errMsg.toLowerCase().includes("microphone") ||
          errMsg.toLowerCase().includes("notfound") ||
          errMsg.toLowerCase().includes("permission")
        ) {
          msg =
            "Microphone not found or access denied. Please check your browser settings and try again.";
        } else if (errType === "daily-error") {
          msg =
            "Could not connect to the AI interviewer. Please ensure your microphone is working and try again.";
        }
        setStatus("error");
        setErrorMsg(msg);
        stopRecordingAndUpload();
        stopCamera();
        if (timerRef.current) clearInterval(timerRef.current);
      });

      // call-start-failed fires when VAPI cannot establish the call
      // (bad API key, Daily.co room creation failure, network block, etc.)
      vapi.on("call-start-failed", (event: unknown) => {
        console.error("[VAPI] call-start-failed:", event);
        const ev = event as Record<string, unknown> | null;
        const reason = String(ev?.status ?? "");
        let msg = "Could not connect to the AI interviewer. Please check your internet connection and try again.";
        if (reason === "failed") {
          msg = "Interview connection failed. Please refresh the page and try again.";
        }
        setStatus("error");
        setErrorMsg(msg);
        stopRecordingAndUpload();
        stopCamera();
        if (timerRef.current) clearInterval(timerRef.current);
      });

      // Use the pre-created VAPI assistant with candidateName injected via variableValues.
      // This avoids the "Meeting has ended" ejection caused by inline config validation.
      const call = await vapi.start(config.hiringAssistantId, {
        variableValues: { candidateName: config.candidateName },
      });
      if (call?.id) callIdRef.current = call.id;
    } catch (err) {
      console.error("[VAPI] start failed:", err);
      setStatus("error");
      setErrorMsg(
        "Could not start the interview. Please check your microphone and try again."
      );
      stopRecordingAndUpload();
      stopCamera();
    }
  }, [
    configQuery.data,
    startCamera,
    startRecording,
    stopCamera,
    stopRecordingAndUpload,
    candidateId,
    saveCallId,
  ]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  // Guard: only stop VAPI if a call is actually in progress.
  // Without this guard, React StrictMode's double-mount fires stop() on the
  // first unmount, which destroys the Daily object → triggers left-meeting
  // → emits call-end before call-start ever fires.

  useEffect(() => {
    return () => {
      const s = statusRef.current;
      if (s === "active" || s === "connecting" || s === "ending") {
        vapiRef.current?.stop();
      }
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCamera]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const endInterview = useCallback(() => {
    vapiRef.current?.stop();
  }, []);

  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const next = !isMuted;
    vapiRef.current.setMuted(next);
    setIsMuted(next);
  }, [isMuted]);

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const isCallActive = status === "active";
  const candidateName = configQuery.data?.candidateName ?? "";
  const firstName = candidateName.split(" ")[0] || "there";

  return (
    <div
      className="relative w-screen h-screen overflow-hidden flex flex-col"
      style={{ backgroundColor: "#080d1a" }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0 z-20"
        style={{
          background:
            "linear-gradient(to bottom, rgba(8,13,26,0.98) 0%, transparent 100%)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#6366f1" }}
          >
            <span className="text-white text-xs font-bold">MIB</span>
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-none">
              AI Interview
            </p>
            <p className="text-white/40 text-xs mt-0.5">Maids in Black</p>
          </div>
        </div>

        {/* Timer */}
        {isCallActive && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              backgroundColor: "rgba(255,255,255,0.07)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-mono">
              {formatDuration(callDuration)}
            </span>
          </div>
        )}

        {/* AI speaking badge */}
        {(isCallActive || status === "connecting") && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all duration-300"
            style={{
              backgroundColor: isSpeaking
                ? "rgba(99,102,241,0.25)"
                : "rgba(255,255,255,0.06)",
              border: isSpeaking
                ? "1px solid rgba(99,102,241,0.45)"
                : "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                isSpeaking ? "bg-indigo-400 animate-pulse" : "bg-white/25"
              }`}
            />
            <span
              className={`text-xs font-medium ${
                isSpeaking ? "text-indigo-300" : "text-white/40"
              }`}
            >
              {isSpeaking ? "AI speaking" : "AI Interviewer"}
            </span>
          </div>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 pb-24">

        {/* Loading */}
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={40} className="animate-spin" style={{ color: "#6366f1" }} />
            <p className="text-white/50 text-base">Loading your interview…</p>
          </div>
        )}

        {/* Ready — show Start button */}
        {status === "ready" && (
          <div className="flex flex-col items-center gap-8 max-w-sm text-center">
            {/* Idle waveform */}
            <WaveformVisualizer isActive={false} isSpeaking={false} />

            <div className="flex flex-col items-center gap-3">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ backgroundColor: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}
              >
                <Mic size={28} style={{ color: "#818cf8" }} />
              </div>
              <p className="text-white text-xl font-semibold">
                Ready to interview, {firstName}
              </p>
              <p className="text-white/45 text-sm leading-relaxed">
                This is a short AI-powered voice interview — about 5 to 8 minutes.
                Your camera will be recorded. Make sure your microphone is working.
              </p>
            </div>

            <button
              onClick={startInterview}
              className="px-10 py-3.5 rounded-full text-white font-semibold text-base transition-all hover:opacity-90 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                boxShadow: "0 4px 24px rgba(99,102,241,0.45)",
              }}
            >
              Start Interview
            </button>
          </div>
        )}

        {/* Connecting */}
        {status === "connecting" && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={40} className="animate-spin" style={{ color: "#6366f1" }} />
            <p className="text-white/55 text-base">Connecting to AI interviewer…</p>
          </div>
        )}

        {/* Active interview */}
        {(status === "active" || status === "ending") && (
          <>
            {/* Waveform */}
            <div className="flex flex-col items-center gap-2 w-full">
              <p className="text-white/35 text-xs uppercase tracking-widest font-medium">
                {isSpeaking ? "AI Interviewer Speaking" : "Listening…"}
              </p>
              <WaveformVisualizer isActive={true} isSpeaking={isSpeaking} />
            </div>

            {/* Camera */}
            <div className="flex flex-col items-center gap-2">
              <CameraFeed stream={cameraStream} />
              {candidateName && (
                <p className="text-white/40 text-sm font-medium">{candidateName}</p>
              )}
            </div>
          </>
        )}

        {/* Uploading progress */}
        {status === "ending" && uploadProgress && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{
              backgroundColor: "rgba(99,102,241,0.12)",
              border: "1px solid rgba(99,102,241,0.25)",
            }}
          >
            <Loader2 size={16} className="animate-spin text-indigo-400" />
            <span className="text-indigo-300 text-sm">{uploadProgress}</span>
          </div>
        )}

        {/* Done */}
        {status === "done" && (
          <div className="flex flex-col items-center gap-5 text-center">
            <CheckCircle2 size={56} style={{ color: "#22c55e" }} />
            <div>
              <p className="text-white text-xl font-semibold">Interview Complete</p>
              <p className="text-white/45 text-sm mt-2 max-w-xs leading-relaxed">
                Your responses have been saved. We'll be in touch within 2 business days.
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-5 max-w-sm text-center">
            <AlertCircle size={48} style={{ color: "#ef4444" }} />
            <p className="text-white/75 text-base leading-relaxed">{errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-7 py-2.5 rounded-full text-white text-sm font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: "#6366f1" }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Bottom controls — active call only */}
      {isCallActive && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-5 pb-8 pt-4 z-20"
          style={{
            background:
              "linear-gradient(to top, rgba(8,13,26,0.95) 0%, transparent 100%)",
          }}
        >
          <button
            onClick={toggleMute}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: isMuted ? "#ef4444" : "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? (
              <MicOff size={22} color="white" />
            ) : (
              <Mic size={22} color="white" />
            )}
          </button>

          <button
            onClick={endInterview}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: "#ef4444",
              boxShadow: "0 4px 20px rgba(239,68,68,0.45)",
            }}
            title="End interview"
          >
            <PhoneOff size={24} color="white" />
          </button>
        </div>
      )}
    </div>
  );
}
