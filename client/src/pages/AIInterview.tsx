/**
 * AI Video Interview — /interview/:candidateId
 *
 * Layout: Full-screen AI interviewer panel (dark, animated avatar),
 * small self-view PiP in bottom-right corner (Zoom-style).
 * Voice powered by VAPI web SDK.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import Vapi from "@vapi-ai/web";
import { trpc } from "@/lib/trpc";
import { Mic, MicOff, PhoneOff, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type InterviewStatus =
  | "loading"      // fetching config
  | "ready"        // config loaded, waiting for user to start
  | "connecting"   // VAPI connecting
  | "active"       // call in progress
  | "ending"       // user clicked end
  | "done"         // call ended, saved
  | "error";       // something went wrong

// ── Constants ────────────────────────────────────────────────────────────────

const ACCENT = "#2563eb";
const GREEN = "#16a34a";

// Interview assistant config — passed inline to VAPI so no pre-created assistant needed
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

After all 4 questions, thank them warmly and let them know the team will be in touch within 2 business days. Keep the conversation natural and encouraging. If they seem nervous, reassure them. Total interview should take 5-8 minutes.

Start by greeting ${firstName} warmly and asking the first question.`,
        },
      ],
    },
    firstMessage: `Hi ${firstName}! Welcome to your interview with Maids in Black. I'm your AI interviewer today. This will be a short, friendly conversation — about 5 to 8 minutes. There are no trick questions, just a chance for us to get to know you better. Ready to get started?`,
    endCallMessage: `Thank you so much for your time today, ${firstName}. It was wonderful speaking with you. Our hiring team will review your application and be in touch within 2 business days. Have a great day!`,
    endCallPhrases: ["goodbye", "bye", "that's all", "thank you, goodbye"],
  };
}

// ── Animated AI Avatar ────────────────────────────────────────────────────────

function AIAvatar({ isSpeaking, isConnecting }: { isSpeaking: boolean; isConnecting: boolean }) {
  return (
    <div className="relative flex items-center justify-center w-full h-full">
      {/* Background gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, #1e3a5f 0%, #0f172a 70%)",
        }}
      />

      {/* Outer pulse rings when speaking */}
      {isSpeaking && (
        <>
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 280,
              height: 280,
              backgroundColor: "rgba(37, 99, 235, 0.15)",
              animationDuration: "1.5s",
            }}
          />
          <div
            className="absolute rounded-full animate-ping"
            style={{
              width: 240,
              height: 240,
              backgroundColor: "rgba(37, 99, 235, 0.2)",
              animationDuration: "1.2s",
              animationDelay: "0.3s",
            }}
          />
        </>
      )}

      {/* Avatar circle */}
      <div
        className="relative z-10 rounded-full flex items-center justify-center transition-all duration-300"
        style={{
          width: 200,
          height: 200,
          background: isSpeaking
            ? "linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)"
            : "linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%)",
          boxShadow: isSpeaking
            ? "0 0 60px rgba(37, 99, 235, 0.6), 0 0 120px rgba(37, 99, 235, 0.3)"
            : "0 0 30px rgba(37, 99, 235, 0.2)",
          border: "3px solid rgba(37, 99, 235, 0.5)",
          transition: "box-shadow 0.3s ease, background 0.3s ease",
        }}
      >
        {isConnecting ? (
          <Loader2 size={64} color="rgba(255,255,255,0.8)" className="animate-spin" />
        ) : (
          <svg viewBox="0 0 100 100" width="120" height="120" fill="none">
            {/* Stylized AI face */}
            <circle cx="50" cy="38" r="22" fill="rgba(255,255,255,0.15)" />
            <circle cx="50" cy="38" r="16" fill="rgba(255,255,255,0.25)" />
            {/* Eyes */}
            <circle
              cx="43"
              cy="35"
              r="3.5"
              fill="white"
              style={{
                animation: isSpeaking ? "eyePulse 1.2s ease-in-out infinite" : "none",
              }}
            />
            <circle
              cx="57"
              cy="35"
              r="3.5"
              fill="white"
              style={{
                animation: isSpeaking ? "eyePulse 1.2s ease-in-out infinite 0.2s" : "none",
              }}
            />
            {/* Mouth — animated when speaking */}
            {isSpeaking ? (
              <ellipse
                cx="50"
                cy="44"
                rx="5"
                ry="3"
                fill="white"
                style={{ animation: "mouthTalk 0.4s ease-in-out infinite alternate" }}
              />
            ) : (
              <path d="M44 44 Q50 48 56 44" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
            )}
            {/* Body */}
            <path
              d="M28 72 Q28 60 50 60 Q72 60 72 72"
              fill="rgba(255,255,255,0.15)"
            />
          </svg>
        )}
      </div>

      {/* Speaking indicator */}
      {isSpeaking && (
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full"
          style={{ backgroundColor: "rgba(37, 99, 235, 0.9)", backdropFilter: "blur(8px)" }}
        >
          <div className="flex items-end gap-0.5 h-4">
            {[0, 1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="w-1 rounded-full bg-white"
                style={{
                  height: `${[40, 70, 100, 70, 40][i]}%`,
                  animation: `soundBar 0.6s ease-in-out infinite`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
          <span className="text-white text-xs font-medium">AI Interviewer speaking…</span>
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes eyePulse {
          0%, 100% { r: 3.5; }
          50% { r: 4.5; }
        }
        @keyframes mouthTalk {
          0% { ry: 2; }
          100% { ry: 4; }
        }
        @keyframes soundBar {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
}

// ── Self-view PiP ─────────────────────────────────────────────────────────────

function SelfView({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div
      className="absolute bottom-24 right-4 rounded-2xl overflow-hidden shadow-2xl"
      style={{
        width: 160,
        height: 120,
        border: "2px solid rgba(255,255,255,0.2)",
        backgroundColor: "#1e293b",
        zIndex: 20,
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
        <div className="w-full h-full flex items-center justify-center">
          <div className="text-center">
            <div
              className="w-10 h-10 rounded-full mx-auto mb-1 flex items-center justify-center"
              style={{ backgroundColor: "#334155" }}
            >
              <span className="text-white text-sm font-bold">You</span>
            </div>
            <span className="text-xs text-gray-400">Camera off</span>
          </div>
        </div>
      )}
      <div
        className="absolute bottom-1 left-1/2 -translate-x-1/2 text-xs text-white/60 font-medium"
        style={{ fontSize: 10 }}
      >
        You
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AIInterview() {
  const params = useParams<{ candidateId: string }>();
  const [, navigate] = useLocation();
  const candidateId = parseInt(params.candidateId ?? "0", 10);

  const [status, setStatus] = useState<InterviewStatus>("loading");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [selfStream, setSelfStream] = useState<MediaStream | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const vapiRef = useRef<Vapi | null>(null);
  const callIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ── tRPC ──────────────────────────────────────────────────────────────────

  const configQuery = trpc.hiring.getInterviewConfig.useQuery(
    { candidateId },
    { enabled: candidateId > 0, retry: 1 }
  );

  const saveCallId = trpc.hiring.saveInterviewCallId.useMutation();

  // ── Camera setup ──────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setSelfStream(stream);
    } catch {
      // Camera permission denied — continue without self-view
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setSelfStream(null);
  }, []);

  // ── VAPI setup ────────────────────────────────────────────────────────────

  const startInterview = useCallback(async () => {
    const config = configQuery.data;
    if (!config) return;

    setStatus("connecting");
    await startCamera();

    try {
      const vapi = new Vapi(config.vapiPublicKey);
      vapiRef.current = vapi;

      vapi.on("call-start", () => {
        setStatus("active");
        timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
      });

      vapi.on("speech-start", () => setIsSpeaking(true));
      vapi.on("speech-end", () => setIsSpeaking(false));

      vapi.on("call-end", () => {
        setIsSpeaking(false);
        if (timerRef.current) clearInterval(timerRef.current);
        stopCamera();
        setStatus("done");
        // Save call ID if we got one
        if (callIdRef.current && candidateId > 0) {
          saveCallId.mutate({ candidateId, callId: callIdRef.current });
        }
      });

      vapi.on("error", (err: unknown) => {
        console.error("[VAPI] error:", err);
        setStatus("error");
        setErrorMsg("Connection error. Please try again.");
        stopCamera();
        if (timerRef.current) clearInterval(timerRef.current);
      });

      // Start call with inline assistant config
      const call = await vapi.start(buildAssistantConfig(config.candidateName));
      if (call?.id) {
        callIdRef.current = call.id;
      }
    } catch (err) {
      console.error("[VAPI] start failed:", err);
      setStatus("error");
      setErrorMsg("Could not connect to the AI interviewer. Please check your microphone permissions and try again.");
      stopCamera();
    }
  }, [configQuery.data, startCamera, stopCamera, candidateId, saveCallId]);

  const endInterview = useCallback(() => {
    setStatus("ending");
    vapiRef.current?.stop();
  }, []);

  const toggleMute = useCallback(() => {
    if (!vapiRef.current) return;
    const newMuted = !isMuted;
    vapiRef.current.setMuted(newMuted);
    setIsMuted(newMuted);
  }, [isMuted]);

  // ── Config loading state ──────────────────────────────────────────────────

  useEffect(() => {
    if (configQuery.data) setStatus("ready");
    if (configQuery.error) {
      setStatus("error");
      setErrorMsg("Could not load interview configuration. Please check the link and try again.");
    }
  }, [configQuery.data, configQuery.error]);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      vapiRef.current?.stop();
      stopCamera();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [stopCamera]);

  // ── Duration formatter ────────────────────────────────────────────────────

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const isCallActive = status === "active" || status === "ending";
  const candidateName = configQuery.data?.candidateName ?? "Candidate";

  return (
    <div
      className="relative w-screen h-screen overflow-hidden select-none"
      style={{ backgroundColor: "#0f172a" }}
    >
      {/* ── AI Interviewer full-screen panel ── */}
      <div className="absolute inset-0">
        <AIAvatar isSpeaking={isSpeaking} isConnecting={status === "connecting"} />
      </div>

      {/* ── Top bar ── */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-4 z-30"
        style={{ background: "linear-gradient(to bottom, rgba(15,23,42,0.9) 0%, transparent 100%)" }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: ACCENT }}
          >
            <span className="text-white text-xs font-bold">MIB</span>
          </div>
          <div>
            <p className="text-white text-sm font-semibold leading-none">AI Interview</p>
            <p className="text-white/50 text-xs mt-0.5">Maids in Black</p>
          </div>
        </div>

        {/* Call timer */}
        {isCallActive && (
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)" }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white text-sm font-mono font-medium">{formatDuration(callDuration)}</span>
          </div>
        )}

        {/* AI label */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ backgroundColor: "rgba(37, 99, 235, 0.3)", backdropFilter: "blur(8px)", border: "1px solid rgba(37,99,235,0.5)" }}
        >
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-blue-200 text-xs font-medium">AI Interviewer</span>
        </div>
      </div>

      {/* ── Self-view PiP ── */}
      {(status === "active" || status === "connecting" || status === "ending") && (
        <SelfView stream={selfStream} />
      )}

      {/* ── Bottom controls ── */}
      <div
        className="absolute bottom-0 left-0 right-0 flex flex-col items-center pb-8 pt-4 z-30"
        style={{ background: "linear-gradient(to top, rgba(15,23,42,0.95) 0%, transparent 100%)" }}
      >
        {/* Status text */}
        <p className="text-white/60 text-sm mb-4">
          {status === "loading" && "Loading interview…"}
          {status === "ready" && `Ready to interview ${candidateName.split(" ")[0]}`}
          {status === "connecting" && "Connecting to AI interviewer…"}
          {status === "active" && "Interview in progress"}
          {status === "ending" && "Ending interview…"}
          {status === "done" && "Interview complete"}
          {status === "error" && errorMsg}
        </p>

        {/* Control buttons */}
        <div className="flex items-center gap-4">
          {/* Ready state — Start button */}
          {status === "ready" && (
            <button
              onClick={startInterview}
              className="flex items-center gap-2 px-8 py-3 rounded-full text-white font-semibold text-sm transition-all hover:opacity-90 active:scale-95"
              style={{ backgroundColor: GREEN, boxShadow: "0 4px 20px rgba(22, 163, 74, 0.4)" }}
            >
              <Mic size={18} />
              Start Interview
            </button>
          )}

          {/* Active state — Mute + End */}
          {isCallActive && (
            <>
              <button
                onClick={toggleMute}
                className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
                style={{
                  backgroundColor: isMuted ? "#ef4444" : "rgba(255,255,255,0.15)",
                  backdropFilter: "blur(8px)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
                title={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted ? <MicOff size={22} color="white" /> : <Mic size={22} color="white" />}
              </button>

              <button
                onClick={endInterview}
                disabled={status === "ending"}
                className="w-16 h-16 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
                style={{
                  backgroundColor: "#ef4444",
                  boxShadow: "0 4px 20px rgba(239, 68, 68, 0.5)",
                }}
                title="End interview"
              >
                {status === "ending" ? (
                  <Loader2 size={24} color="white" className="animate-spin" />
                ) : (
                  <PhoneOff size={24} color="white" />
                )}
              </button>
            </>
          )}

          {/* Done state */}
          {status === "done" && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={24} color={GREEN} />
                <span className="text-white font-semibold">Interview saved to your profile</span>
              </div>
              <button
                onClick={() => navigate("/apply")}
                className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
                style={{ backgroundColor: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}
              >
                Return to Application
              </button>
            </div>
          )}

          {/* Error state */}
          {status === "error" && (
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={24} color="#ef4444" />
                <span className="text-white/80 text-sm text-center max-w-sm">{errorMsg}</span>
              </div>
              <button
                onClick={() => setStatus("ready")}
                className="px-6 py-2 rounded-full text-white text-sm font-medium transition-all hover:opacity-90"
                style={{ backgroundColor: ACCENT }}
              >
                Try Again
              </button>
            </div>
          )}

          {/* Loading state */}
          {status === "loading" && (
            <Loader2 size={32} color="rgba(255,255,255,0.5)" className="animate-spin" />
          )}
        </div>

        {/* Mic permission hint */}
        {status === "ready" && (
          <p className="text-white/30 text-xs mt-3">
            Microphone access required · Camera optional
          </p>
        )}
      </div>
    </div>
  );
}
