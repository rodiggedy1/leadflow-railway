import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** A route chunk that failed to download (Chrome, Safari, Firefox and Vite CSS preload wording). */
export function isStaleDynamicImport(error: Error | null): boolean {
  const message = `${error?.name}: ${error?.message}`;
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Unable to preload CSS")
  );
}

// Shown while the startup script in index.html fetches a fresh copy of the page. No button: it keeps
// retrying on its own; the phone number appears from the third attempt, matching the startup script.
function RetryingLoader() {
  const attempt = Number(new URLSearchParams(window.location.search).get("lf_retry")) || 0;
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div role="status" aria-label="Loading" className="w-8 h-8 border-4 border-[#E8735A] border-t-transparent rounded-full animate-spin" />
      {attempt >= 2 ? (
        <p className="text-sm text-muted-foreground">
          Still loading. You can also book by phone: <a href="tel:+12028885362" className="underline">202-888-5362</a>
        </p>
      ) : null}
    </div>
  );
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    if (!isStaleDynamicImport(error)) return;
    const retryLoad = (window as Window & { __leadflowRetryLoad?: () => void }).__leadflowRetryLoad;
    if (retryLoad) {
      retryLoad();
      return;
    }
    // Page served without the startup script: fall back to one plain reload per session.
    const recoveryKey = "leadflow-stale-chunk-recovery";
    try {
      if (!sessionStorage.getItem(recoveryKey)) {
        sessionStorage.setItem(recoveryKey, "1");
        window.location.reload();
      }
    } catch {}
  }

  render() {
    if (this.state.hasError && isStaleDynamicImport(this.state.error)) return <RetryingLoader />;
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">An unexpected error occurred.</h2>

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
