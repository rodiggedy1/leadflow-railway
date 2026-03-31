/**
 * AI Video Interview — /interview/:candidateId
 *
 * Layout:
 *  - Full-screen dark background
 *  - Large animated waveform visualizer (AI speaking indicator)
 *  - Applicant's camera feed in a prominent center card
 *  - Auto-starts VAPI on page load (after mic permission granted)
 *  - Records applicant camera via MediaRecorder → uploads to S3 on call end
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "wouter";
import Vapi from "@vapi-ai/web";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, PhoneOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type InterviewStatus =
  | "loading"       // fetching config
  | "permission"    // asking for mic/camera permission
  | "connecting"    // VAPI connecting
  | "active"        // call in progress
  | "ending"        // user clicked end / call ended, uploading video
  | "done"          // upload complete
  | "error";        // something went wrong

// ── Build VAPI assistant config inline ───────────────────────────────────────

function buildAssistantConfig(candidateName: string) {
  const firstName = candidateName.split(" ")[0] ?? candidateName;
  return {
    name: "Hiring Interview Assistant",
    voice: {
      provider: "playht" as const,
      voiceId: "jennifer",
    },
    model: {
      provider: "openai" as const,
      model: "gpt-4o" as const,
      messages: [
        {
          role: "system" as const,
          content: `You are a friendly, professional hiring interviewer for Maids in Black, a premium residential cleaning company. You are conducting a short screening interview with ${firstName}.

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
    endCallPhrases: ["goodbye", "bye", "that's all", "thank you, goodbye"],
  };
}

// ── Waveform Visualizer ───────────────────────────────────────────────────────

function WaveformVisualizer({
  isActive,
  isSpeaking,
  analyserRef,
}: {
  isActive: boolean;
  isSpeaking: boolean;
  analyserRef: React.RefObject<AnalyserNode | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const BAR_COUNT = 64;
    const dataArray = new Uint8Array(BAR_COUNT * 2);

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const analyser = analyserRef.current;
      if (analyser && isSpeaking) {
        analyser.getByteFrequencyData(dataArray);
      }

      const barW = W / BAR_COUNT;
      for (let i = 0; i < BAR_COUNT; i++) {
        let barH: number;
        if (analyser && isSpeaking) {
          barH = (dataArray[i] / 255) * H * 0.9;
        } else if (isActive) {
          // Gentle idle pulse
          barH = (Math.sin(Date.now() / 600 + i * 0.3) * 0.5 + 0.5) * H * 0.12 + H * 0.04;
        } else {
          barH = H * 0.04;
        }

        const x = i * barW;
        const y = H / 2 - barH / 2;

        // Gradient: blue → indigo
        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, isSpeaking ? "rgba(99,102,241,0.9)" : "rgba(99,102,241,0.4)");
        grad.addColorStop(1, isSpeaking ? "rgba(139,92,246,0.9)" : "rgba(139,92,246,0.4)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x + 1, y, barW - 2, barH, 3);
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isActive, isSpeaking, analyserRef]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={120}
      className="w-full max-w-xl"
      style={{ display: "block" }}
    />
  );
}

// ── Self-view Camera Feed ─────────────────────────────────────────────────────

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
        maxWidth: 480,
        aspectRatio: "4/3",
        backgroundColor: "#1e293b",
        border: "2px solid rgba(99,102,241,0.3)",
        boxShadow: "0 0 40px rgba(99,102,241,0.15)",
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
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "#334155" }}
          >
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
          </div>
          <span className="text-white/40 text-sm">Camera starting…</span>
        </div>
      )}

      {/* REC indicator */}
      {stream && (
        <div
          className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
          style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
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
  const recordedChunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── tRPC ──────────────────────────────────────────────────────────────────

  const configQuery = trpc.hiring.getInterviewConfig.useQuery(
    { candidateId },
    { enabled: candidateId > 0, retry: 1 }
  );

  const saveCallId = trpc.hiring.saveInterviewCallId.useMutation();
  const saveInterviewVideo = trpc.hiring.saveInterviewVideo.useMutation();

  // ── Camera + Mic setup ────────────────────────────────────────────────────

  const startCameraAndMic = useCallback(async (): Promise<{ videoStream: MediaStream; micOk: boolean }> => {
    // Start camera (video only for recording)
    let videoStream: MediaStream | null = null;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      cameraStreamRef.current = videoStream;
      setCameraStream(videoStream);
    } catch {
      // Camera denied — continue without it
      videoStream = new MediaStream();
    }

    // Check mic
    let micOk = false;
    try {
      const micTest = await navigator.mediaDevices.getUserMedia({ audio: true });
      micTest.getTracks().forEach(t => t.stop());
      micOk = true;
    } catch {
      micOk = false;
    }

    return { videoStream, micOk };
  }, []);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach(t => t.stop());
    cameraStreamRef.current = null;
    setCameraStream(null);
  }, []);

  // ── MediaRecorder: record camera video ───────────────────────────────────

  const startRecording = useCallback((stream: MediaStream) => {
    if (!stream || stream.getVideoTracks().length === 0) return;
    recordedChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "video/mp4";
    try {
      const mr = new MediaRecorder(stream, { mimeType });
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.start(1000); // collect chunks every 1s
      mediaRecorderRef.current = mr;
    } catch (err) {
      console.warn("[MediaRecorder] Could not start recording:", err);
    }
  }, []);

  const stopRecordingAndUpload = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;

    return new Promise<void>((resolve) => {
      mr.onstop = async () => {
        const chunks = recordedChunksRef.current;
        if (chunks.length === 0 || candidateId <= 0) { resolve(); return; }

        try {
          setUploadProgress("Saving your interview video…");
          const mimeType = chunks[0].type || "video/webm";
          const blob = new Blob(chunks, { type: mimeType });
          const ext = mimeType.includes("mp4") ? "mp4" : "webm";

          const arrayBuf = await blob.arrayBuffer();
          const res = await fetch("/api/upload/video", {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: arrayBuf,
          });
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          const { url } = await res.json() as { url: string };

          // Save the interview video URL to the candidate record
          await saveInterviewVideo.mutateAsync({ candidateId, interviewVideoUrl: url });
          setUploadProgress("");
        } catch (err) {
          console.error("[Interview] Video upload failed:", err);
          setUploadProgress("");
        }
        resolve();
      };
      mr.stop();
    });
  }, [candidateId, saveInterviewVideo]);

  // ── Audio analyser for waveform ───────────────────────────────────────────

  const setupAudioAnalyser = useCallback(() => {
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      // Connect to mic via getUserMedia
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const src = ctx.createMediaStreamSource(stream);
        src.connect(analyser);
      }).catch(() => {/* no mic — waveform won't animate but that's ok */});
    } catch {
      // AudioContext not available
    }
  }, []);

  // ── Auto-start VAPI when config loads ────────────────────────────────────

  const launchInterview = useCallback(async (config: { vapiPublicKey: string; candidateName: string }) => {
    setStatus("permission");

    const { micOk, videoStream } = await startCameraAndMic();

    if (!micOk) {
      setStatus("error");
      setErrorMsg("Microphone access is required for the interview. Please allow microphone access in your browser and refresh the page.");
      stopCamera();
      return;
    }

    // Start recording camera
    startRecording(videoStream);

    // Setup audio analyser for waveform
    setupAudioAnalyser();

    setStatus("connecting");

    try {
      const vapi = new Vapi(config.vapiPublicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setStatus("active");
        timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
      });

      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));

      vapi.on("call-end", async () => {
        setIsSpeaking(false);
        if (timerRef.current) clearInterval(timerRef.current);
        setStatus("ending");

        // Save call ID
        if (callIdRef.current && candidateId > 0) {
          saveCallId.mutate({ candidateId, callId: callIdRef.current });
        }

        // Stop recording and upload
        await stopRecordingAndUpload();
        stopCamera();
        setStatus("done");
      });

      vapi.on("error", (err: unknown) => {
        console.error("[VAPI] error:", err);
        const errObj = err as Record<string, unknown>;
        const errType = String(errObj?.type ?? "");
        let msg = "Connection error. Please refresh the page and try again.";
        if (errType === "daily-error") {
          msg = "Could not connect to the AI interviewer. Please ensure your microphone is working and try again.";
        }
        setStatus("error");
        setErrorMsg(msg);
        stopRecordingAndUpload().then(() => stopCamera());
        if (timerRef.current) clearInterval(timerRef.current);
      });

      const call = await vapi.start(buildAssistantConfig(config.candidateName));
      if (call?.id) callIdRef.current = call.id;

    } catch (err) {
      console.error("[VAPI] start failed:", err);
      setStatus("error");
      setErrorMsg("Could not start the interview. Please check your microphone and try again.");
      await stopRecordingAndUpload();
      stopCamera();
    }
  }, [startCameraAndMic, stopCamera, startRecording, setupAudioAnalyser, stopRecordingAndUpload, candidateId, saveCallId]);

  // Auto-launch when config is ready
  useEffect(() => {
    if (configQuery.data && status === "loading") {
      launchInterview(configQuery.data);
    }
    if (configQuery.error && status === "loading") {
      setStatus("error");
      setErrorMsg("Could not load interview. Please check the link and try again.");
    }
  }, [configQuery.data, configQuery.error, status, launchInterview]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      vapiRef.current?.stop();
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
      audioCtxRef.current?.close();
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

  return (
    <div
      className="relative w-screen h-screen overflow-hidden flex flex-col"
      style={{ backgroundColor: "#0a0f1e" }}
    >
      {/* ── Top bar ── */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0 z-20"
        style={{ background: "linear-gradient(to bottom, rgba(10,15,30,0.95) 0%, transparent 100%)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "#6366f1" }}
          >
            <span className="text-white text-xs font-bold">MIB</span>
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-none">AI Interview</p>
            <p className="text-white/40 text-xs mt-0.5">Maids in Black</p>
          </div>
        </div>

        {/* Timer */}
        {isCallActive && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", backdropFilter: "blur(8px)" }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-mono">{formatDuration(callDuration)}</span>
          </div>
        )}

        {/* AI speaking badge */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{
            backgroundColor: isSpeaking ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)",
            border: isSpeaking ? "1px solid rgba(99,102,241,0.5)" : "1px solid rgba(255,255,255,0.1)",
            transition: "all 0.3s ease",
          }}
        >
          <div className={`w-2 h-2 rounded-full ${isSpeaking ? "bg-indigo-400 animate-pulse" : "bg-white/30"}`} />
          <span className={`text-xs font-medium ${isSpeaking ? "text-indigo-300" : "text-white/40"}`}>
            {isSpeaking ? "AI speaking" : "AI Interviewer"}
          </span>
        </div>
      </div>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 pb-24">

        {/* Loading / Permission / Connecting states */}
        {(status === "loading" || status === "permission" || status === "connecting") && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 size={48} className="animate-spin" style={{ color: "#6366f1" }} />
            <p className="text-white/60 text-base">
              {status === "loading" && "Loading your interview…"}
              {status === "permission" && "Requesting camera & microphone…"}
              {status === "connecting" && "Connecting to AI interviewer…"}
            </p>
          </div>
        )}

        {/* Active interview */}
        {(status === "active" || status === "ending") && (
          <>
            {/* Waveform visualizer — AI audio */}
            <div className="flex flex-col items-center gap-3 w-full">
              <p className="text-white/40 text-xs uppercase tracking-widest font-medium">
                {isSpeaking ? "AI Interviewer Speaking" : "Listening…"}
              </p>
              <WaveformVisualizer
                isActive={true}
                isSpeaking={isSpeaking}
                analyserRef={analyserRef}
              />
            </div>

            {/* Applicant camera */}
            <div className="flex flex-col items-center gap-2">
              <CameraFeed stream={cameraStream} />
              {candidateName && (
                <p className="text-white/50 text-sm font-medium">{candidateName}</p>
              )}
            </div>
          </>
        )}

        {/* Ending — uploading */}
        {status === "ending" && uploadProgress && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ backgroundColor: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)" }}>
            <Loader2 size={16} className="animate-spin text-indigo-400" />
            <span className="text-indigo-300 text-sm">{uploadProgress}</span>
          </div>
        )}

        {/* Done */}
        {status === "done" && (
          <div className="flex flex-col items-center gap-4">
            <CheckCircle2 size={56} style={{ color: "#22c55e" }} />
            <div className="text-center">
              <p className="text-white text-xl font-semibold">Interview Complete</p>
              <p className="text-white/50 text-sm mt-1">Your responses have been saved. We'll be in touch within 2 business days.</p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && (
          <div className="flex flex-col items-center gap-4 max-w-sm text-center">
            <AlertCircle size={48} style={{ color: "#ef4444" }} />
            <p className="text-white/80 text-base">{errorMsg}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2.5 rounded-full text-white text-sm font-semibold transition-all hover:opacity-90"
              style={{ backgroundColor: "#6366f1" }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom controls (active call only) ── */}
      {isCallActive && (
        <div
          className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-5 pb-8 pt-4 z-20"
          style={{ background: "linear-gradient(to top, rgba(10,15,30,0.95) 0%, transparent 100%)" }}
        >
          {/* Mute */}
          <button
            onClick={toggleMute}
            className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
            style={{
              backgroundColor: isMuted ? "#ef4444" : "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {isMuted ? <MicOff size={22} color="white" /> : <Mic size={22} color="white" />}
          </button>

          {/* End call */}
          <button
            onClick={endInterview}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
            style={{ backgroundColor: "#ef4444", boxShadow: "0 4px 20px rgba(239,68,68,0.5)" }}
            title="End interview"
          >
            <PhoneOff size={24} color="white" />
          </button>
        </div>
      )}
    </div>
  );
}
