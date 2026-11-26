import { httpBatchLink, httpLink, splitLink } from "@trpc/client";
import superjson from "superjson";

/** The app's tRPC request links. Requests are batched exactly as before unless a query opts in:
 *  - context.batch "none": sent on its own, so it never waits for slower queries;
 *  - context.batch "background": batched only with other background queries. */
export function createTrpcLinks(fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args)) {
  const linkOptions = {
    url: "/api/trpc",
    methodOverride: "POST" as const,
    transformer: superjson,
    fetch(input: RequestInfo | URL, init?: RequestInit) {
      return fetchImpl(input, {
        ...(init ?? {}),
        credentials: "include",
      });
    },
  };
  return [
    splitLink({
      condition: op => op.context.batch === "none",
      true: httpLink(linkOptions),
      false: splitLink({
        condition: op => op.context.batch === "background",
        true: httpBatchLink(linkOptions),
        false: httpBatchLink(linkOptions),
      }),
    }),
  ];
}
