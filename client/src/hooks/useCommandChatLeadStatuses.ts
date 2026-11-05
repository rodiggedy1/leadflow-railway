import { useEffect, useMemo, useState } from "react";
import {
  CancelledError,
  isServer,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../lib/trpc";

export type CommandChatLeadStatuses = inferRouterOutputs<AppRouter>["opsChat"]["getLeadSessionStatuses"];
export type CommandChatLeadStatus = CommandChatLeadStatuses[number];
export type StatusAuthScope = Readonly<{ identity: number; epoch: number }>;

const authEpochs = new WeakMap<QueryClient, number>();
export function allocateStatusAuthScope(queryClient: QueryClient, identity: number): StatusAuthScope {
  const epoch = (authEpochs.get(queryClient) ?? 0) + 1;
  authEpochs.set(queryClient, epoch);
  return { identity, epoch };
}

// Canonicalize requests only. All non-null IDs and all original cards remain eligible.
export function canonicalSessionIds(ids: readonly (number | null)[]): number[] {
  return Array.from(new Set(ids.filter((id): id is number => id !== null))).sort((a, b) => a - b);
}

export function statusQueryKey(baseKey: QueryKey, scope: StatusAuthScope | null): QueryKey {
  return [...baseKey, { commandChatLeadStatuses: scope }];
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError({ revert: true });
}

class SerialGate {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

// Survives cohort changes, unmount and auth re-entry for this QueryClient.
const gates = new WeakMap<QueryClient, SerialGate>();
function gateFor(queryClient: QueryClient): SerialGate {
  let gate = gates.get(queryClient);
  if (!gate) {
    gate = new SerialGate();
    gates.set(queryClient, gate);
  }
  return gate;
}

type RetryPolicy = boolean | number | ((failureCount: number, error: Error) => boolean) | undefined;
export function scopedStatusRetry(defaultRetry: RetryPolicy): (failureCount: number, error: Error) => boolean {
  return (failureCount, error) => {
    if (error instanceof TRPCClientError && error.data?.code === "BAD_REQUEST") return false;
    if (typeof defaultRetry === "function") return defaultRetry(failureCount, error);
    if (typeof defaultRetry === "number") return failureCount < defaultRetry;
    if (typeof defaultRetry === "boolean") return defaultRetry;
    return failureCount < (isServer ? 0 : 3);
  };
}

export function statusQueryOptions<R extends { id: number }>(args: {
  queryClient: QueryClient;
  baseKey: QueryKey;
  scope: StatusAuthScope | null;
  sessionIds: readonly number[];
  enabled: boolean;
  request: (input: { sessionIds: number[] }) => Promise<R[]>;
}) {
  const queryKey = statusQueryKey(args.baseKey, args.scope);
  const defaultRetry = args.queryClient.defaultQueryOptions({ queryKey }).retry;
  const sessionIds = canonicalSessionIds(args.sessionIds);
  return {
    queryKey,
    enabled: args.enabled && args.scope !== null && sessionIds.length > 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: scopedStatusRetry(defaultRetry),
    queryFn: ({ signal }: { signal: AbortSignal }) => gateFor(args.queryClient).run(async () => {
      // Queued obsolete work must not issue even its first request.
      checkCancelled(signal);
      const rows: R[] = [];
      for (let offset = 0; offset < sessionIds.length; offset += 50) {
        checkCancelled(signal);
        // Do NOT pass the consumed signal to transport: keep the gate occupied
        // until this already-started promise settles, even after cancellation.
        const batch = await args.request({ sessionIds: sessionIds.slice(offset, offset + 50) });
        checkCancelled(signal);
        rows.push(...batch);
      }
      checkCancelled(signal);
      return rows; // No partial cache publication or fabricated missing rows.
    }),
  };
}

export async function cleanupStatusAuthScope(queryClient: QueryClient, scope: StatusAuthScope): Promise<void> {
  const predicate = (query: { queryKey: QueryKey }) => {
    const tail = query.queryKey[query.queryKey.length - 1] as { commandChatLeadStatuses?: StatusAuthScope } | undefined;
    return tail?.commandChatLeadStatuses?.identity === scope.identity
      && tail.commandChatLeadStatuses.epoch === scope.epoch;
  };
  await queryClient.cancelQueries({ predicate });
  queryClient.removeQueries({ predicate });
}

type AuthBinding = {
  queryClient: QueryClient;
  scope: StatusAuthScope;
  active: boolean;
};

export function useCommandChatLeadStatuses(args: {
  sessionIds: readonly (number | null)[];
  identity: number | null;
  enabled: boolean;
}) {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const canonicalIds = useMemo(() => canonicalSessionIds(args.sessionIds), [args.sessionIds]);
  const [binding, setBinding] = useState<AuthBinding | null>(null);

  useEffect(() => {
    if (args.identity === null) {
      setBinding(null);
      return;
    }
    // Allocate only in committed setup, never during render. StrictMode's second
    // setup owns a fresh scope; asynchronous old cleanup cannot retire that scope.
    const next: AuthBinding = {
      queryClient,
      scope: allocateStatusAuthScope(queryClient, args.identity),
      active: true,
    };
    setBinding(next);
    return () => {
      next.active = false;
      void cleanupStatusAuthScope(queryClient, next.scope);
    };
  }, [queryClient, args.identity]);

  const scope = binding?.active && binding.queryClient === queryClient
    && binding.scope.identity === args.identity ? binding.scope : null;
  const baseKey = getQueryKey(trpc.opsChat.getLeadSessionStatuses, { sessionIds: canonicalIds }, "query");
  const options = statusQueryOptions<CommandChatLeadStatus>({
    queryClient,
    baseKey,
    scope,
    sessionIds: canonicalIds,
    enabled: args.enabled,
    request: (input) => utils.client.opsChat.getLeadSessionStatuses.query(input),
  });
  // Ordinary useQuery: supplemental status loading never suspends the inbox.
  const result = useQuery(options);
  return {
    ...result,
    data: scope !== null && args.enabled ? result.data : undefined,
    canonicalIds,
    queryKey: options.queryKey,
  };
}
