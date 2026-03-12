/**
 * SmsComposeBox — OpenPhone-style SMS compose area.
 *
 * Features:
 *  - Multi-line auto-growing textarea
 *  - Emoji picker (click smiley icon)
 *  - Send button (arrow) — enabled only when there is text
 *  - Ctrl/Cmd+Enter to send
 */
import { useRef, useState, useEffect } from "react";
import EmojiPicker, { type EmojiClickData, Theme } from "emoji-picker-react";
import { Send, Smile } from "lucide-react";

interface SmsComposeBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSend: () => void;
  isSending?: boolean;
  placeholder?: string;
}

export default function SmsComposeBox({
  value,
  onChange,
  onSend,
  isSending = false,
  placeholder = "Write a message...",
}: SmsComposeBoxProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea height
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [value]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  const handleEmojiClick = (data: EmojiClickData) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + data.emoji);
      return;
    }
    const start = ta.selectionStart ?? value.length;
    const end = ta.selectionEnd ?? value.length;
    const next = value.slice(0, start) + data.emoji + value.slice(end);
    onChange(next);
    // Restore cursor after emoji
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + data.emoji.length, start + data.emoji.length);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (value.trim() && !isSending) onSend();
    }
  };

  const canSend = value.trim().length > 0 && !isSending;

  return (
    <div className="relative">
      {/* Emoji picker popover */}
      {showEmoji && (
        <div
          ref={pickerRef}
          className="absolute bottom-full mb-2 right-0 z-50 shadow-xl rounded-xl overflow-hidden"
        >
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            theme={Theme.LIGHT}
            width={320}
            height={380}
            searchDisabled={false}
            skinTonesDisabled
            previewConfig={{ showPreview: false }}
          />
        </div>
      )}

      {/* Compose box */}
      <div
        className="rounded-2xl border-2 transition-colors bg-white"
        style={{
          borderColor: showEmoji ? "#E8603C" : "#e5e7eb",
        }}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {}}
          placeholder={placeholder}
          rows={2}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-gray-800 placeholder:text-gray-400 outline-none leading-relaxed"
          style={{ minHeight: "56px", maxHeight: "160px" }}
        />

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          {/* Left icons */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowEmoji(v => !v)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                showEmoji
                  ? "bg-orange-100 text-orange-500"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
              title="Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          {/* Right: char count + send */}
          <div className="flex items-center gap-2">
            {value.length > 0 && (
              <span className="text-xs text-gray-400 tabular-nums">
                {value.length}/1600
              </span>
            )}
            <button
              type="button"
              onClick={() => { if (canSend) onSend(); }}
              disabled={!canSend}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${
                canSend
                  ? "text-white shadow-sm"
                  : "bg-gray-100 text-gray-300 cursor-not-allowed"
              }`}
              style={canSend ? { backgroundColor: "#E8603C" } : {}}
              title="Send (Ctrl+Enter)"
            >
              {isSending ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin block" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-1.5 px-1">
        Ctrl+Enter to send
      </p>
    </div>
  );
}
