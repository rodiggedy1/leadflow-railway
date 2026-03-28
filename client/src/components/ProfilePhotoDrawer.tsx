/**
 * ProfilePhotoDrawer — slide-in drawer for viewing/uploading a profile photo.
 * Shows the current photo (or a colored initial circle fallback), lets the user
 * pick a new image, and uploads it via the uploadProfilePhoto tRPC procedure.
 *
 * Usage:
 *   <ProfilePhotoDrawer
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     callerName="Alice"
 *     currentPhotoUrl={photoUrl}
 *     onPhotoUpdated={(url) => setPhotoUrl(url)}
 *   />
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { senderHex } from "@/lib/senderColor";
import { X, Camera, Loader2, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ProfilePhotoDrawerProps {
  open: boolean;
  onClose: () => void;
  callerName: string;
  currentPhotoUrl: string | null;
  onPhotoUpdated?: (url: string) => void;
}

export default function ProfilePhotoDrawer({
  open,
  onClose,
  callerName,
  currentPhotoUrl,
  onPhotoUpdated,
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
      // Invalidate all caches that carry photo URLs so every avatar refreshes immediately
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

    // Show local preview immediately
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
        <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col items-center gap-5">
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
            {/* Camera overlay */}
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

          {/* Remove photo option */}
          {(currentPhotoUrl || previewUrl) && !uploading && (
            <button
              onClick={() => {
                setPreviewUrl(null);
                onPhotoUpdated?.("");
                // Upload empty string to clear — just clear locally for now
                toast.info("Photo removed from this session. Re-upload to set a new one.");
              }}
              className="text-xs text-red-400 hover:text-red-600 underline transition"
            >
              Remove photo
            </button>
          )}
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
