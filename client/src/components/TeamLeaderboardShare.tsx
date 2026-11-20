import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Copy, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { shareTeamLeaderboard, type TeamLeaderboardSharePorts } from '@shared/teamLeaderboardSharing';

export function TeamLeaderboardShare({ profile, conversationPhone, sessionId, sendMessage }: {
  profile: { id: number; phone: string | null } | null | undefined;
  conversationPhone: string;
  sessionId: number;
  sendMessage: TeamLeaderboardSharePorts['sendMessage'];
}) {
  const getMagicLink = trpc.cleaner.getMagicLink.useMutation();
  const busy = useRef(false);
  const [working, setWorking] = useState<'send' | 'copy' | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const digits = (phone: string | null | undefined) => (phone ?? '').replace(/[^\d]/g, '').slice(-10);
  const matched = Boolean(profile?.id && digits(profile.phone).length === 10 && digits(profile.phone) === digits(conversationPhone));

  async function act(action: 'copy' | 'send') {
    if (busy.current || !profile || !matched) return;
    busy.current = true;
    setWorking(action);
    setManualCopy(null);
    try {
      const result = await shareTeamLeaderboard(action, {
        cleanerProfileId: profile.id,
        profilePhone: profile.phone,
        conversationPhone,
        sessionId,
      }, window.location.origin, { getMagicLink: getMagicLink.mutateAsync, sendMessage });
      if (action === 'copy') {
        try {
          await navigator.clipboard.writeText(result.url);
          toast.success(`Leaderboard link for ${result.cleanerName} copied.`);
        } catch {
          setManualCopy(result.url);
          toast.info('Select and copy the leaderboard link below.');
        }
      } else {
        toast.success(`Leaderboard link sent to ${result.cleanerName}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to share the leaderboard link.');
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  return <div className="space-y-3" data-team-leaderboard-share>
    <Button type="button" variant="outline" className="rounded-2xl justify-start h-12 w-full border-violet-200 text-violet-700 hover:bg-violet-50" disabled={!matched || sessionId <= 0 || working !== null} onClick={() => void act('send')}>
      {working === 'send' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
      Send leaderboard link
    </Button>
    <Button type="button" variant="outline" className="rounded-2xl justify-start h-12 w-full border-slate-200 text-slate-700 hover:bg-slate-50" disabled={!matched || working !== null} onClick={() => void act('copy')}>
      {working === 'copy' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />}
      Copy leaderboard link
    </Button>
    {manualCopy && <input aria-label="Team leaderboard link" className="w-full rounded-lg border border-slate-200 p-2 text-xs" value={manualCopy} readOnly onFocus={event => event.currentTarget.select()} />}
  </div>;
}
