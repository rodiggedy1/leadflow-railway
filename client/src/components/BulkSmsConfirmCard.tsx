/**
 * BulkSmsConfirmCard — shared bulk SMS confirmation card.
 *
 * Used by both AiConcierge and CommandChat when card.recipients.length > 1.
 * Single-recipient flows continue to use their own per-context cards.
 */
import React, { useState } from "react";
import { Users, Edit3, Send, Loader2, User, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { MissionMetadata } from "@/hooks/useMissionHistory";

export interface BulkSmsRecipient {
  cleanerProfileId: number;
  name: string;
  phone: string;
}

export interface BulkSmsConfirmCardData {
  targetDescription: string;
  recipients: BulkSmsRecipient[];
  draftMessage: string;
  command?: string;
}

export interface BulkSmsSentResult {
  message: string;
  results: Array<{ name: string; phone: string; success: boolean; error?: string }>;
  mission?: MissionMetadata;
}

export function BulkSmsConfirmCard({
  card,
  onSent,
  onDismiss,
}: {
  card: BulkSmsConfirmCardData;
  onSent: (result: BulkSmsSentResult) => void;
  onDismiss?: () => void;
}) {
  const [draft, setDraft] = useState(card.draftMessage);
  const [sent, setSent] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const sendMutation = trpc.aiConcierge.sendBulkSms.useMutation();
  const activeRecipients = card.recipients.filter(r => !excluded.has(r.phone));

  function toggleRecipient(phone: string) {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  }

  function handleSend() {
    if (sent || sendMutation.isPending) return;
    sendMutation.mutate(
      {
        recipients: activeRecipients,
        message: draft,
        ...(card.command ? { command: card.command } : {}),
      },
      {
        onSuccess: (result) => {
          setSent(true);
          onSent({ message: result.message, results: result.results, mission: result.mission ?? undefined });
        },
      }
    );
  }

  return (
    <div className="rounded-2xl rounded-tl-sm overflow-hidden" style={{ background: "linear-gradient(135deg,#fffdf9,#f7f0ff)", border: "1px solid #e5d9ea", boxShadow: "0 4px 20px rgba(116,71,245,0.08)" }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: "1px solid #e5d9ea" }}>
        <Users className="w-4 h-4 flex-shrink-0" style={{ color: "#7447f5" }} />
        <p className="text-sm font-semibold" style={{ color: "#202431" }}>Text {card.targetDescription}</p>
        <span className="ml-auto text-xs text-gray-500">{activeRecipients.length} of {card.recipients.length} recipient{card.recipients.length !== 1 ? "s" : ""}</span>
        {onDismiss && (
          <button onClick={onDismiss} style={{ background: "#f0f2f7", border: "none", borderRadius: 8, width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#667085", fontSize: 12, marginLeft: 4 }}>✕</button>
        )}
      </div>
      <div className="px-4 pt-3 pb-2 flex flex-wrap gap-1.5">
        {card.recipients.map((r) => {
          const isExcluded = excluded.has(r.phone);
          return (
            <button
              key={r.phone}
              type="button"
              onClick={() => !sent && toggleRecipient(r.phone)}
              title={isExcluded ? "Click to re-add" : "Click to remove"}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all"
              style={{
                background: isExcluded ? "rgba(0,0,0,0.04)" : "rgba(116,71,245,0.08)",
                border: isExcluded ? "1px solid #d0d0d8" : "1px solid #e5d9ea",
                color: isExcluded ? "#aaa" : "#4a4a5a",
                opacity: isExcluded ? 0.5 : 1,
                cursor: sent ? "default" : "pointer",
                textDecoration: isExcluded ? "line-through" : "none",
              }}
            >
              <User className="w-3 h-3" style={{ color: isExcluded ? "#bbb" : "#9b8aaa" }} />
              <span className="font-medium" style={{ color: isExcluded ? "#aaa" : "#202431" }}>{r.name}</span>
              <span style={{ color: isExcluded ? "#ccc" : "#9b8aaa" }}>·</span>
              <span style={{ color: isExcluded ? "#aaa" : "#7447f5" }}>{r.phone}</span>
              {isExcluded && <X className="w-3 h-3 ml-0.5" style={{ color: "#bbb" }} />}
            </button>
          );
        })}
      </div>
      <div className="px-4 pb-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Edit3 className="w-3 h-3" style={{ color: "#7447f5" }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "#7447f5" }}>Message</span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sent || sendMutation.isPending}
          rows={10}
          className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-colors disabled:opacity-60"
          style={{ background: "rgba(255,255,255,0.8)", border: "1px solid #e5d9ea", color: "#2d3039", minHeight: "200px" }}
        />
      </div>
      {!sent && (
        <div className="px-4 pb-4">
          <button
            onClick={handleSend}
            disabled={!draft.trim() || sendMutation.isPending || activeRecipients.length === 0}
            className="w-full flex items-center justify-center gap-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-semibold text-white transition-all"
            style={{ background: "linear-gradient(135deg,#7447f5,#9b6ff5)" }}
          >
            {sendMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            ) : (
              <><Send className="w-4 h-4" /> Send text{activeRecipients.length > 1 ? ` to ${activeRecipients.length} people` : ""}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
