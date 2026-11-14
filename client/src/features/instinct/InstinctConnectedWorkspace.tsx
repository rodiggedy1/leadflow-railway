import React, { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import type { InstinctApi } from "@shared/instinct";
import { InstinctPanels } from "./InstinctPanels";
import { useInstinct } from "./useInstinct";

/** Actual tRPC client, not a simulated API. Kept out of injected fixtures. */
export function InstinctConnectedWorkspace() {
  const utils = trpc.useUtils();
  const client = utils.client;
  const api = useMemo<InstinctApi>(() => ({
    sources: input => client.aiActions.instinct.sources.query(input),
    feed: input => client.aiActions.instinct.feed.query(input),
    check: input => client.aiActions.instinct.check.mutate(input),
    evidence: input => client.aiActions.instinct.evidence.query(input),
    reverify: input => client.aiActions.instinct.reverify.mutate(input),
    dayReview: input => client.aiActions.instinct.dayReview.mutate(input),
    ask: input => client.aiActions.instinct.ask.mutate(input),
  }), [client]);
  const binding = useInstinct(api);
  const { controller, state } = binding;
  useOpsStream({ onNewMessage: controller.requestRefresh, onLeadUpdate: controller.requestRefresh,
    onGmailNewMessages: controller.requestRefresh, onConnected: controller.requestRefresh,
    onJobUpdate: controller.recordHint, onBookingFunnelUpdate: controller.recordHint },
    { enabled: state.foreground && !state.paused, label: "Instinct read-only" });
  return <InstinctPanels binding={binding} />;
}
