import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import { reportIssue } from "@/lib/feedback";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Wrap sonner's `toast` so any surfaced error also offers a way to reach us
// (feedback form / call) via the bottom-left FeedbackBubble. Every existing
// `toast.error(...)` call site gets this for free.
const baseError = sonnerToast.error;
const toast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    error: ((...args: Parameters<typeof sonnerToast.error>) => {
      const message = typeof args[0] === "string" ? args[0] : undefined;
      reportIssue({ message });
      return baseError(...args);
    }) as typeof sonnerToast.error,
  },
);

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="dark"
    className="toaster group"
    position="bottom-right"
    gap={8}
    toastOptions={{
      duration: 4000,
      classNames: {
        actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
        cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
