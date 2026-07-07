import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorScreen } from "@/components/features/ErrorScreen";
import { captureClientException } from "@/lib/analytics";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render-time errors anywhere below it and shows the retro-TV error
 * screen (with feedback CTAs) instead of a blank white page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App crashed:", error, info.componentStack);
    captureClientException(error, {
      boundary_name: "app_error_boundary",
      component_stack_present: Boolean(info.componentStack),
    });
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background pt-20 pb-16 px-4">
        <ErrorScreen
          errorCode="500"
          screenMessage="SIGNAL LOST"
          title="Well, this is awkward"
          description="Something glitched on our end and the screen went dark. A refresh usually brings it back — if not, we'd really like to hear from you."
          actions={
            <>
              <button
                type="button"
                onClick={this.handleReload}
                className="font-dm-sans inline-block select-none rounded-full bg-primary px-8 py-3 text-lg font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Reload page
              </button>
              <a
                href="/"
                className="font-dm-sans inline-block select-none rounded-full border border-border px-8 py-3 text-lg font-medium text-foreground/80 transition-colors hover:text-foreground"
              >
                Go to Home
              </a>
            </>
          }
        />
      </div>
    );
  }
}
