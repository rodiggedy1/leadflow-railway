/**
 * TypingBubble
 * WhatsApp-style animated "X is typing..." indicator.
 * Shows three bouncing dots with the typer names above.
 */
import React from "react";

interface TypingBubbleProps {
  typers: string[];
}

export function TypingBubble({ typers }: TypingBubbleProps) {
  if (typers.length === 0) return null;

  const label =
    typers.length === 1
      ? `${typers[0]} is typing`
      : typers.length === 2
      ? `${typers[0]} and ${typers[1]} are typing`
      : `${typers[0]} and ${typers.length - 1} others are typing`;

  return (
    <div className="flex items-end gap-2 px-3 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
      {/* Bubble */}
      <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm max-w-[180px]">
        {/* Three bouncing dots */}
        <span className="flex items-center gap-[3px]">
          <span
            className="w-2 h-2 rounded-full bg-slate-400 inline-block"
            style={{ animation: "typingBounce 1.2s ease-in-out infinite", animationDelay: "0ms" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-400 inline-block"
            style={{ animation: "typingBounce 1.2s ease-in-out infinite", animationDelay: "200ms" }}
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-400 inline-block"
            style={{ animation: "typingBounce 1.2s ease-in-out infinite", animationDelay: "400ms" }}
          />
        </span>
        <span className="text-xs text-slate-500 truncate">{label}</span>
      </div>
    </div>
  );
}
