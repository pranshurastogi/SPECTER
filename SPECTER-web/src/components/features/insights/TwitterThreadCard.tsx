import { Suspense, Component, type ReactNode } from "react";
import { Tweet } from "react-tweet";
import { ExternalLink } from "lucide-react";
import { XLogo } from "./XLogo";
import type { TwitterThread } from "./insightsData";

function TweetLoadingSkeleton() {
  return (
    <div className="rounded-2xl bg-zinc-950 border border-amber-500/15 p-5 flex flex-col gap-3 min-h-[220px] animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-zinc-800" />
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-28 rounded bg-zinc-800" />
          <div className="h-2.5 w-18 rounded bg-zinc-800" />
        </div>
      </div>
      <div className="space-y-2 mt-1">
        <div className="h-3 w-full rounded bg-zinc-800" />
        <div className="h-3 w-4/5 rounded bg-zinc-800" />
        <div className="h-3 w-3/5 rounded bg-zinc-800" />
      </div>
    </div>
  );
}

function TweetFallbackCard({ thread }: { thread: TwitterThread }) {
  return (
    <div className="rounded-2xl bg-zinc-950 border border-amber-500/15 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <XLogo className="w-4 h-4 text-zinc-300" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Thread on X
          </span>
        </div>
        <span className="text-xs text-zinc-600">{thread.date}</span>
      </div>

      {thread.previewImageUrl && (
        <a
          href={thread.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block overflow-hidden rounded-xl"
        >
          <img
            src={thread.previewImageUrl}
            alt={thread.title}
            loading="lazy"
            className="w-full object-cover max-h-48 brightness-80 hover:brightness-100 transition-all duration-300"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </a>
      )}

      <div className="flex flex-wrap gap-1.5">
        {thread.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
          >
            {tag}
          </span>
        ))}
      </div>

      <h3 className="text-base font-bold text-zinc-100">{thread.title}</h3>
      <p className="text-sm text-zinc-400 leading-relaxed">{thread.summary}</p>

      <a
        href={thread.url}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start inline-flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors mt-auto pt-2 border-t border-zinc-800 w-full"
      >
        <XLogo className="w-3.5 h-3.5" />
        Open thread on X
        <ExternalLink className="w-3 h-3 ml-auto" />
      </a>
    </div>
  );
}

interface ErrorBoundaryState { hasError: boolean }
interface ErrorBoundaryProps { thread: TwitterThread; children: ReactNode }

class TweetErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <TweetFallbackCard thread={this.props.thread} />;
    }
    return this.props.children;
  }
}

function TweetEmbed({ thread }: { thread: TwitterThread }) {
  return (
    <div className="rounded-2xl overflow-hidden [&>div]:!m-0 [&_.react-tweet-theme]:!rounded-2xl">
      <Suspense fallback={<TweetLoadingSkeleton />}>
        <TweetErrorBoundary thread={thread}>
          <Tweet id={thread.tweetId} />
        </TweetErrorBoundary>
      </Suspense>
    </div>
  );
}

export function TwitterThreadCard({ thread }: { thread: TwitterThread }) {
  return (
    <div className="group hover:scale-[1.015] transition-transform duration-200">
      <div className="mb-3 flex items-center gap-2 px-1 min-w-0">
        <XLogo className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest truncate flex-1 min-w-0">
          {thread.title}
        </span>
        <div className="flex gap-1.5 shrink-0">
          {thread.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 whitespace-nowrap"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
      <TweetEmbed thread={thread} />
    </div>
  );
}
