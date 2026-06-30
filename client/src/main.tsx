import "@/lib/i18n"; // initialize i18next singleton
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { OpsChatProvider } from "./contexts/OpsChatContext";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Never retry on 429 (rate limit) — retrying makes it worse.
      // Allow 1 retry on other transient errors.
      retry: (failureCount, error) => {
        if (error instanceof TRPCClientError) {
          if (error.message === "Rate exceeded.") return false;
          if (error.data?.httpStatus === 429) return false;
          if (error.data?.httpStatus === 401 || error.data?.httpStatus === 403) return false;
        }
        return failureCount < 1;
      },
      // 2 minute default stale time — prevents re-fetching on every focus/mount
      staleTime: 2 * 60 * 1000,
      // Do not re-fetch on window focus or reconnect by default
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    mutations: {
      retry: false,
    },
  },
});

// Expected auth errors that should NOT be logged as errors — they are normal
// 401 responses from adminAgentProcedure / cleanerProcedure when the user
// hasn't logged in yet. Logging them as errors creates noise and confusion.
const EXPECTED_AUTH_ERRORS = new Set([
  "Agent login required",
  "Cleaner login required",
]);

const isExpectedAuthError = (error: unknown): boolean => {
  if (!(error instanceof TRPCClientError)) return false;
  return EXPECTED_AUTH_ERRORS.has(error.message);
};

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

  // Admin and agent pages use their own cookie-based auth — never redirect them
  // to Manus OAuth. A protectedProcedure error on those pages just means the
  // Manus user session is absent, which is expected and fine.
  const path = window.location.pathname;
  if (path.startsWith("/admin") || path.startsWith("/agent") || path.startsWith("/cleaner") || path.startsWith("/auth")) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    // Suppress expected auth errors — these are normal 401s from agent/cleaner
    // procedures when visited without a session. Not bugs, not worth logging.
    if (!isExpectedAuthError(error)) {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    if (!isExpectedAuthError(error)) {
      console.error("[API Mutation Error]", error);
    }
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      method: "POST",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <OpsChatProvider>
        <App />
      </OpsChatProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
