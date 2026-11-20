import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { withTeamLeaderboardDestination } from "@shared/teamLeaderboardAccess";
import "./team-leaderboard-admin.css";

export function TeamLeaderboardAdminLink({ teamName, cleanerProfileId, unavailableReason, resolveProfile }: {
  teamName: string;
  cleanerProfileId: number | null;
  unavailableReason?: string;
  resolveProfile: () => Promise<number | null>;
}) {
  const getMagicLink = trpc.cleaner.getMagicLink.useMutation();
  const busy = useRef(false);
  const mounted = useRef(true);
  const [working, setWorking] = useState(false);
  const [link, setLink] = useState<{ profileId: number; url: string } | null>(null);
  const [status, setStatus] = useState("");
  const available = Number.isSafeInteger(cleanerProfileId) && (cleanerProfileId ?? 0) > 0;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { setLink(null); setStatus(""); }, [cleanerProfileId]);

  async function copy() {
    if (busy.current || !available) return;
    busy.current = true;
    setWorking(true);
    setLink(null);
    setStatus("");
    try {
      // Refresh the canonical account before retrieval; never copy a cached former account.
      const profileId = await resolveProfile();
      if (!mounted.current) return;
      if (!Number.isSafeInteger(profileId) || (profileId ?? 0) <= 0) {
        throw new Error("No active linked team account is available.");
      }
      const origin = window.location.origin;
      const result = await getMagicLink.mutateAsync({ cleanerProfileId: profileId!, origin });
      if (!mounted.current) return;
      const url = withTeamLeaderboardDestination(result.url, origin);
      if (!url) throw new Error("The existing team link could not be used for the leaderboard.");
      setLink({ profileId: profileId!, url });
      try {
        await navigator.clipboard.writeText(url);
        if (mounted.current) setStatus("Link copied.");
      } catch {
        if (mounted.current) setStatus("Select and copy the link below.");
      }
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? error.message : "Unable to copy this team’s link.");
    } finally {
      busy.current = false;
      if (mounted.current) setWorking(false);
    }
  }

  const displayedLink = link?.profileId === cleanerProfileId ? link.url : null;
  return <div className="tl-admin-link" data-team-admin-link>
    <div className="tl-admin-link-line">
      <span>{available ? "Team leaderboard magic link" : unavailableReason ?? "No active linked team account"}</span>
      <button type="button" disabled={!available || working} onClick={() => void copy()} aria-label={`Copy leaderboard magic link for ${teamName}`}>
        <Copy size={14} aria-hidden="true" />{working ? "Copying…" : "Copy magic link"}
      </button>
    </div>
    {status && <p role="status">{status}</p>}
    {displayedLink && <input aria-label={`Leaderboard magic link for ${teamName}`} value={displayedLink} readOnly onFocus={event => event.currentTarget.select()} />}
  </div>;
}
