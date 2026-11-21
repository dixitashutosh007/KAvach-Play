"use client";

/**
 * Renders plain text with safe, clickable http(s) links (`components/ui/LinkifiedText.tsx`).
 * Links open in a new tab and never bubble clicks to a parent card or dialog.
 */
import React from "react";
import { splitTextWithLinks } from "@/lib/linkify";

export function LinkifiedText({ text, className = "" }: { text: string | null | undefined; className?: string }) {
  const segments = splitTextWithLinks(text);
  return (
    <span className={className}>
      {segments.map((seg, i) =>
        seg.type === "link" ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-scarlet underline decoration-scarlet/40 underline-offset-2 break-all hover:text-deep-wine focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50 rounded"
          >
            {seg.value}
          </a>
        ) : (
          <React.Fragment key={i}>{seg.value}</React.Fragment>
        ),
      )}
    </span>
  );
}
