/**
 * ProfilePhotoDrawer — slide-in drawer for viewing/uploading a profile photo.
 * Also shows the team agent status list with DM buttons.
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { senderHex } from "@/lib/senderColor";
import { X, Camera, Loader2, CheckCheck, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Agent {
  id: number;
  name: string;
  email?: string | null;
  photoUrl?: string | null;
  lastSeenAt?: number | null;
  awayStatus?: string | null;
}

interface ProfilePhotoDrawerProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
  currentPhotoUrl: string | null;
  onPhotoUpdated?: (url: string) => void;
  // DMs / agent status
  agentStatusData?: { agents: Agent[] } | null;
  dmUnreadMap?: Record<string, number>;
  myDmKey?: string;
  totalDmUnread?: number;
  onOpenDm?: (name: string, key: string, photoUrl: string | null) => void;
}

export default function ProfilePhotoDrawer({
  open,
  onClose,
  callerName,
  currentPhotoUrl,
  onPhotoUpdated,
  agentStatusData,
  dmUnreadMap = {},
  myDmKey = "",
  onOpenDm,
}: ProfilePhotoDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  const utils = trpc.useUtils();

  const uploadMutation = trpc.opsChat.uploadProfilePhoto.useMutation({
    onSuccess: (res) => {
      setUploaded(true);
      setUploading(false);
      onPhotoUpdated?.(res.url);
      void utils.opsChat.getAllAgentPhotoMap.invalidate();
      void utils.opsChat.getMyProfile.invalidate();
      void utils.opsChat.getAgentStatusList.invalidate();
      toast.success("Profile photo updated!");
      setTimeout(() => setUploaded(false), 2000);
    },
    onError: (err) => {
      setUploading(false);
      toast.error("Upload failed", { description: err.message });
    },
  });

  const initial = (callerName ?? "?")[0].toUpperCase();
  const color = senderHex(callerName ?? "");
  const displayUrl = previewUrl ?? currentPhotoUrl;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setUploading(true);
    setUploaded(false);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await uploadMutation.mutateAsync({ base64Data, mimeType: file.type });
    } catch {
      // error handled by onError
    }
  }

  if (!open) return null;

  const awayLabels: Record<string, string> = {
    away_sec: "Away for a sec ☕",
    lunch:    "Lunch break 🍔",
    back15:   "Back in 15 ⏰",
    eod:      "Signing off 🌙",
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9990] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 z-[9991] w-80 bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">My Profile</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Profile section */}
          <div className="px-5 py-6 flex flex-col items-center gap-5">
            {/* Avatar */}
            <div className="relative group">
              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt={callerName}
                  className="w-28 h-28 rounded-full object-cover shadow-lg ring-4 ring-white"
                />
              ) : (
                <div
                  className="w-28 h-28 rounded-full flex items-center justify-center text-4xl font-bold text-white shadow-lg ring-4 ring-white"
                  style={{ backgroundColor: color }}
                >
                  {initial}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Change photo"
              >
                <Camera className="h-7 w-7 text-white" />
              </button>
            </div>

            {/* Name */}
            <div className="text-center">
              <p className="text-lg font-bold text-slate-900">{callerName}</p>
              <p className="text-sm text-slate-400">Ops Team</p>
            </div>

            {/* Upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition",
                uploaded
                  ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                  : "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50"
              )}
            >
              {uploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
              ) : uploaded ? (
                <><CheckCheck className="h-4 w-4" /> Photo updated!</>
              ) : (
                <><Camera className="h-4 w-4" /> {currentPhotoUrl ? "Change Photo" : "Upload Photo"}</>
              )}
            </button>

            <p className="text-xs text-slate-400 text-center">
              JPG, PNG, or WebP · Max 5 MB<br />
              Your photo appears next to your messages.
            </p>

            {(currentPhotoUrl || previewUrl) && !uploading && (
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  onPhotoUpdated?.("");
                  toast.info("Photo removed from this session. Re-upload to set a new one.");
                }}
                className="text-xs text-red-400 hover:text-red-600 underline transition"
              >
                Remove photo
              </button>
            )}
          </div>

          {/* Team / DMs section */}
          <div className="border-t border-slate-100">
            <div className="px-5 py-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Team</p>
            </div>
            <div className="divide-y divide-slate-50">
              {!agentStatusData ? (
                <div className="px-5 py-6 text-center text-sm text-slate-400">Loading…</div>
              ) : agentStatusData.agents.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-slate-400">No agents found</div>
              ) : agentStatusData.agents.map((ag) => {
                const now = Date.now();
                const seenMs = ag.lastSeenAt;
                const diffMin = seenMs ? Math.floor((now - seenMs) / 60_000) : null;
                const agStatus: "online" | "away" | "offline" = ag.awayStatus
                  ? "away"
                  : diffMin === null ? "offline"
                  : diffMin <= 2 ? "online"
                  : diffMin <= 15 ? "away"
                  : "offline";
                const statusLabel = ag.awayStatus ? (awayLabels[ag.awayStatus] ?? "Away")
                  : seenMs === null || diffMin === null ? "Never logged in"
                  : diffMin === 0 ? "Active now"
                  : diffMin < 60 ? `${diffMin}m ago`
                  : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago`
                  : new Date(seenMs).toLocaleDateString("en-US", { timeZone: "America/New_York" });
                const dotColor = agStatus === "online" ? "bg-green-500" : agStatus === "away" ? "bg-amber-400" : "bg-slate-300";

                const agEmail = ag.email ?? "";
                const threadKey = agEmail && myDmKey.includes("@")
                  ? [myDmKey, agEmail].sort().join("::")
                  : "";
                const agentUnread = threadKey ? (dmUnreadMap[threadKey] ?? 0) : 0;

                return (
                  <div key={ag.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="relative shrink-0">
                      {ag.photoUrl ? (
                        <img src={ag.photoUrl} alt={ag.name} className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ backgroundColor: senderHex(ag.name) }}
                        >
                          {ag.name[0].toUpperCase()}
                        </div>
                      )}
                      <span className={cn("absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white", dotColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{ag.name}</p>
                      <p className={cn("text-xs truncate",
                        agStatus === "online" ? "text-green-600 font-medium" :
                        agStatus === "away" ? "text-amber-500" :
                        "text-slate-400"
                      )}>
                        {agStatus === "online" ? "Online" : agStatus === "away" ? `Away • ${statusLabel}` : statusLabel}
                      </p>
                    </div>
                    {onOpenDm && (
                      <button
                        onClick={() => { onOpenDm(ag.name, ag.email ?? ag.name, ag.photoUrl ?? null); onClose(); }}
                        className="relative ml-1 p-1.5 rounded-full hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition-colors"
                        title={agentUnread > 0 ? `${agentUnread} unread DM${agentUnread > 1 ? "s" : ""} from ${ag.name}` : `DM ${ag.name}`}
                      >
                        <MessageCircle className="w-4 h-4" />
                        {agentUnread > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center leading-none">
                            {agentUnread > 9 ? "9+" : agentUnread}
                          </span>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    </>
  );
}
