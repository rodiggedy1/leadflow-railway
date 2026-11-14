import React from "react";
import { trpc } from "@/lib/trpc";
import type { InstinctApi } from "@shared/instinct";
import { InstinctPanels } from "@/features/instinct/InstinctPanels";
import { InstinctConnectedWorkspace } from "@/features/instinct/InstinctConnectedWorkspace";
import { useInstinct, type InstinctEnvironment } from "@/features/instinct/useInstinct";

/** Validation mounts this actual component with an explicit synthetic read port.
 * No default fixtures, application bootstrap, network transport or SSE is used. */
export function InstinctWorkspace({ api, environment }: { api: InstinctApi; environment?: InstinctEnvironment }) {
  const binding = useInstinct(api, environment);
  return <InstinctPanels binding={binding} />;
}
export default function InstinctCustomerIntelligence() {
  const me = trpc.agents.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false,
    refetchOnReconnect: false, refetchInterval: false, gcTime: 0 });
  if (me.isLoading) return <div className="instinct-customer-intelligence"><div className="empty" role="status">Checking admin access…</div></div>;
  if (me.error || me.data?.isAdmin !== true) return <div className="instinct-customer-intelligence"><div className="empty" role="alert">Admin access required. Sign in with an admin agent account.</div></div>;
  return <InstinctConnectedWorkspace />;
}
