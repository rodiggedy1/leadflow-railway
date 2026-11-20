import { withTeamLeaderboardDestination } from './teamLeaderboardAccess';

export type TeamLeaderboardShareTarget = {
  cleanerProfileId: number;
  profilePhone: string | null;
  conversationPhone: string;
  sessionId: number;
};
export type TeamLeaderboardSharePorts = {
  getMagicLink: (input: { cleanerProfileId: number; origin: string }) => Promise<{ url: string; cleanerName: string }>;
  sendMessage: (input: { sessionId: number; message: string; fromNumberId: string }) => Promise<{ smsSent: boolean; duplicate?: boolean }>;
};

/** Explicit staff action only: reuse existing login, cookies and SMS transport. */
export async function shareTeamLeaderboard(
  action: 'copy' | 'send',
  target: TeamLeaderboardShareTarget,
  origin: string,
  ports: TeamLeaderboardSharePorts,
): Promise<{ url: string; cleanerName: string; sent: boolean }> {
  const captured = { ...target };
  const digits = (phone: string | null) => (phone ?? '').replace(/[^\d]/g, '').slice(-10);
  const profilePhone = digits(captured.profilePhone);
  if (!Number.isInteger(captured.cleanerProfileId) || captured.cleanerProfileId <= 0 ||
      profilePhone.length !== 10 || profilePhone !== digits(captured.conversationPhone)) {
    throw new Error('Wait for the matching team account before sharing its leaderboard.');
  }
  if (action === 'send' && (!Number.isInteger(captured.sessionId) || captured.sessionId <= 0)) {
    throw new Error('Open this team’s SMS conversation before sending the leaderboard.');
  }
  const existing = await ports.getMagicLink({ cleanerProfileId: captured.cleanerProfileId, origin });
  const url = withTeamLeaderboardDestination(existing.url, origin);
  if (!url) throw new Error('The existing portal link could not be prepared for the leaderboard.');
  if (action === 'copy') return { url, cleanerName: existing.cleanerName, sent: false };
  const result = await ports.sendMessage({
    sessionId: captured.sessionId,
    message: `Here are your Maids in Black team results. Tap to view the leaderboard and your team’s feedback:\n${url}`,
    // Exactly the same CS line override as the existing Inbox magic-link action.
    fromNumberId: 'PN0wVLcpCq',
  });
  if (!result.smsSent) {
    throw new Error(result.duplicate
      ? 'The sender skipped this as a duplicate. No new SMS was sent.'
      : 'SMS delivery was not confirmed. The message may appear in the conversation; do not assume it was sent.');
  }
  return { url, cleanerName: existing.cleanerName, sent: true };
}
