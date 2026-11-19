import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

type LinkContext = {
  source: "booking" | "leadflow";
  id: number;
  assignedTeamName: string | null;
  assignmentVersionRef?: { current: number };
  assignmentVersion: number | undefined;
  cleanerProfileId: number | undefined;
  ready: boolean;
};
type LinkFeedback = {
  context: LinkContext;
  url?: string;
  label?: string;
  notice?: string;
  error?: string;
};

export function BookingTeamMagicLink({ source, id, assignedTeamName, assignmentVersionRef, disabled = false }: {
  source: "booking" | "leadflow";
  id: number;
  assignedTeamName: string | null;
  assignmentVersionRef?: { current: number };
  disabled?: boolean;
}) {
  const enabled = Boolean(assignedTeamName) && !disabled;
  const profile = trpc.bookings.teamPortalProfile.useQuery({ source, id }, { enabled, staleTime: 0, refetchOnMount: "always" });
  const mutation = trpc.cleaner.getMagicLink.useMutation();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [feedback, setFeedback] = useState<LinkFeedback | null>(null);
  const cleanerProfileId = profile.data?.cleanerProfileId;
  const ready = enabled && !profile.isFetching && !profile.error &&
    profile.data?.source === source && profile.data?.id === id &&
    typeof cleanerProfileId === "number" && Number.isInteger(cleanerProfileId) && cleanerProfileId > 0;
  const nextContext: LinkContext = {
    source, id, assignedTeamName, assignmentVersionRef,
    assignmentVersion: assignmentVersionRef?.current, cleanerProfileId, ready,
  };
  const context = useRef(nextContext);
  // Invalidate immediately during render, not in an effect after an old URL can paint.
  if (context.current.source !== source || context.current.id !== id ||
    context.current.assignedTeamName !== assignedTeamName ||
    context.current.assignmentVersionRef !== assignmentVersionRef ||
    context.current.assignmentVersion !== nextContext.assignmentVersion ||
    context.current.cleanerProfileId !== cleanerProfileId || context.current.ready !== ready) {
    context.current = nextContext;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isCurrent = (request: LinkContext) => mounted.current && context.current === request &&
    request.ready && request.assignmentVersion === request.assignmentVersionRef?.current;

  const copyLink = async () => {
    const request = context.current;
    if (!isCurrent(request) || mutation.isPending || inFlight.current) return;
    inFlight.current = true;
    setFeedback(null);
    try {
      const result = await mutation.mutateAsync({
        cleanerProfileId: request.cleanerProfileId!,
        origin: "https://quote.maidinblack.com",
      });
      if (!isCurrent(request)) return;
      const label = profile.data?.teamName ?? result.cleanerName;
      const link = { context: request, url: result.url, label };
      setFeedback(link);
      if (!navigator.clipboard?.writeText) {
        setFeedback({ ...link, notice: "Select and copy the link below." });
        return;
      }
      try {
        await navigator.clipboard.writeText(result.url);
        if (isCurrent(request)) setFeedback({ ...link, notice: `${label}'s portal link copied.` });
      } catch {
        if (isCurrent(request)) setFeedback({ ...link, notice: "Copy was unavailable. Select and copy the link below." });
      }
    } catch (cause) {
      if (isCurrent(request)) {
        setFeedback({ context: request, error: cause instanceof Error ? cause.message : "The team portal link could not be retrieved." });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const visible = feedback && isCurrent(feedback.context) ? feedback : null;
  const profileError = enabled && profile.error ? profile.error.message : null;
  return (
    <div className="bcr-team-portal-link">
      <div className="bcr-team-portal-actions">
        <button type="button" onClick={copyLink} disabled={!ready || mutation.isPending}>
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
          {mutation.isPending ? "Getting link…" : "Copy team portal link"}
        </button>
        {visible?.url && <a href={visible.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />Open portal</a>}
      </div>
      {!assignedTeamName && <p>Assign a team to access its portal link.</p>}
      {visible?.notice && <p role="status">{visible.notice}</p>}
      {(visible?.error || profileError) && <p role="alert">{visible?.error ?? profileError}</p>}
      {visible?.url && <input type="text" aria-label={`${visible.label} portal magic link`} value={visible.url} readOnly onFocus={event => event.currentTarget.select()} />}
    </div>
  );
}
