import { ArrowRight, Clock } from "lucide-react";
import type { MediumPost } from "./insightsData";

export function MediumBlogCard({ post }: { post: MediumPost }) {
  return (
    <article className="group relative rounded-2xl overflow-hidden bg-zinc-950 border border-amber-500/15 hover:border-amber-400/50 transition-all duration-300 hover:shadow-xl hover:shadow-amber-500/10">
      {/* Subtle top gold glow on hover */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      {/* Cover */}
      <a
        href={post.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
        aria-label={`Read ${post.title} on Medium`}
      >
        <div className="aspect-[16/7] overflow-hidden bg-zinc-900">
          <img
            src={post.coverImage}
            alt={post.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 brightness-75 group-hover:brightness-90"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              const parent = e.currentTarget.parentElement;
              if (parent) {
                parent.style.background =
                  "linear-gradient(135deg, #1a1200 0%, #0d0d0d 100%)";
              }
            }}
          />
          {/* Gold shimmer overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
        </div>
      </a>

      {/* Body */}
      <div className="p-6 flex flex-col gap-4">
        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Title */}
        <h3 className="text-lg sm:text-xl font-bold leading-snug text-zinc-100 group-hover:text-amber-400 transition-colors duration-200">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {post.title}
          </a>
        </h3>

        {/* Summary */}
        <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3">
          {post.summary}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-zinc-800/80">
          <div className="flex items-center gap-2.5 text-xs text-zinc-500">
            <span>{post.author}</span>
            <span className="text-zinc-700">·</span>
            <span>{post.publishedDate}</span>
            <span className="text-zinc-700">·</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {post.readTime}
            </span>
          </div>

          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors shrink-0"
          >
            Read on Medium
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>
      </div>
    </article>
  );
}
