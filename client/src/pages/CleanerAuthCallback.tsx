/**
 * CleanerAuthCallback — /auth/cleaner-callback
 *
 * Dedicated auth callback page for magic link login.
 * This page does ONE thing: exchange the magic token for a session cookie,
 * wait for the session to be confirmed, then redirect to /portal-v2.
 *
 * It never renders the portal UI. It never checks existing sessions.
 * It is the ONLY place that calls verifyMagicLink.
 *
 * Flow:
 *   1. User taps magic link: https://quote.maidinblack.com/auth/cleaner-callback?token=XXX
 *   2. This page reads the token from the URL
 *   3. Calls verifyMagicLink mutation — server sets the session cookie in the response
 *   4. On success: confirms session is active by calling cleaner.me, then redirects to /portal-v2
 *   5. On failure: shows error message with a link back to the login page (/cleaner)
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type State = "verifying" | "confirming" | "success" | "error";

export default function CleanerAuthCallback() {
  // Read token from URL once — never re-read
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [state, setState] = useState<State>(token ? "verifying" : "error");
  const [errorMsg, setErrorMsg] = useState<string>(
    token ? "" : "No login token found in URL. Please use the link from your SMS."
  );

  const hasRedirected = useRef(false);

  const verifyMutation = trpc.cleaner.verifyMagicLink.useMutation();
  const meQuery = trpc.cleaner.me.useQuery(undefined, {
    // Only run after we've verified the token — not before
    enabled: state === "confirming",
    retry: 3,
    retryDelay: 500,
  });

  // Step 1: Exchange the token for a session cookie
  useEffect(() => {
    if (!token) return;
    verifyMutation.mutate(
      { token },
      {
        onSuccess: () => {
          // Cookie is now set in the browser. Move to confirming phase.
          setState("confirming");
        },
        onError: (err) => {
          setErrorMsg(err.message || "Login link failed. Please ask your manager to send a new one.");
          setState("error");
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 2: Confirm the session is active, then redirect
  useEffect(() => {
    if (state !== "confirming") return;
    if (meQuery.isLoading) return;

    if (meQuery.data) {
      // Session confirmed — redirect immediately.
      // No setState("success") or setTimeout: avoiding a pending React state update
      // during page unload, which caused a removeChild crash in the commit phase.
      // hasRedirected ref ensures this fires at most once even if the effect re-runs.
      if (!hasRedirected.current) {
        hasRedirected.current = true;
        window.location.replace("/portal-v2");
      }
    } else if (meQuery.isError || (!meQuery.isLoading && !meQuery.data)) {
      // Session not found even after verification — something went wrong
      setErrorMsg("Session could not be confirmed. Please try the link again or contact your manager.");
      setState("error");
    }
  }, [state, meQuery.data, meQuery.isLoading, meQuery.isError]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="text-center max-w-sm">
        {(state === "verifying" || state === "confirming") && (
          <>
            <Loader2 className="w-12 h-12 text-emerald-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-lg font-semibold mb-1">
              {state === "verifying" ? "Signing you in…" : "Confirming session…"}
            </p>
            <p className="text-slate-400 text-sm">Please wait a moment</p>
          </>
        )}

        {state === "success" && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold mb-1">Logged in!</p>
            <p className="text-slate-400 text-sm">Redirecting to your portal…</p>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <p className="text-white text-lg font-semibold mb-2">Login failed</p>
            <p className="text-slate-400 text-sm mb-6">{errorMsg}</p>
            <Button
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
              onClick={() => window.location.replace("/cleaner")}
            >
              Go to login page
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
