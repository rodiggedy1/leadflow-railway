/**
 * MessageFlowPanel
 * Visual SMS sequence timeline for Reactivation and Post-Sale Review flows.
 *
 * Shows each step as:
 *   - A trigger label (when it fires)
 *   - A realistic SMS bubble preview with variable substitution
 *   - An inline edit mode (click pencil → textarea → Save)
 *   - A locked badge for opt-out messages
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Pencil,
  Lock,
  Check,
  X,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type FlowType = "reactivation" | "review";

interface MessageFlowPanelProps {
  flowType: FlowType;
  /** Sample values used to preview variable substitution */
  sampleVars?: Record<string, string>;
}

const DEFAULT_SAMPLE_VARS: Record<string, string> = {
  "[Name]": "Sarah",
  "[Discount]": "10",
  "[LastPrice]": "150",
  "[DiscountedPrice]": "135",
  "[GoogleReviewUrl]": "https://g.page/r/maids-in-black/review",
};

function substituteVars(body: string, vars: Record<string, string>): string {
  let result = body;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replaceAll(key, val);
  }
  return result;
}

interface TemplateRow {
  id: number;
  stepKey: string;
  label: string;
  triggerLabel: string;
  body: string;
  variables: string[];
  isEditable: number;
}

function TemplateCard({
  template,
  sampleVars,
  onSaved,
}: {
  template: TemplateRow;
  sampleVars: Record<string, string>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.body);
  const [showPreview, setShowPreview] = useState(true);

  const updateMutation = trpc.messageTemplates.update.useMutation({
    onSuccess: () => {
      toast.success("Message saved");
      setEditing(false);
      onSaved();
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const isLocked = !template.isEditable;
  const previewText = substituteVars(template.body, sampleVars);

  return (
    <div className="relative pl-8">
      {/* Timeline dot */}
      <div className="absolute left-0 top-4 w-4 h-4 rounded-full bg-primary border-2 border-background shadow-sm flex items-center justify-center">
        <MessageSquare className="w-2 h-2 text-primary-foreground" />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground">{template.label}</span>
              {isLocked && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  Locked
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              {template.triggerLabel}
            </div>
          </div>
          {!isLocked && !editing && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs gap-1 shrink-0"
              onClick={() => {
                setDraft(template.body);
                setEditing(true);
              }}
            >
              <Pencil className="w-3 h-3" />
              Edit
            </Button>
          )}
        </div>

        {/* Edit mode */}
        {editing ? (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[100px] text-sm font-mono resize-y"
              placeholder="SMS message body..."
            />
            {/* Variable hints */}
            {template.variables.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <span className="text-xs text-muted-foreground mr-1">Variables:</span>
                {template.variables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="text-xs bg-muted hover:bg-muted/80 text-muted-foreground px-1.5 py-0.5 rounded font-mono cursor-pointer transition-colors"
                    onClick={() => setDraft((d) => d + v)}
                    title={`Insert ${v}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            {/* Live preview while editing */}
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1.5 font-medium">Preview (with sample values)</p>
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%] whitespace-pre-wrap leading-relaxed">
                  {substituteVars(draft, sampleVars)}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-3 text-xs gap-1"
                onClick={() => setEditing(false)}
              >
                <X className="w-3 h-3" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 px-3 text-xs gap-1"
                disabled={updateMutation.isPending || draft.trim().length < 10}
                onClick={() => updateMutation.mutate({ id: template.id, body: draft.trim() })}
              >
                <Check className="w-3 h-3" />
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          /* Preview mode */
          <div>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => setShowPreview((v) => !v)}
            >
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span className="font-medium">Message preview</span>
                {showPreview ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </div>
            </button>
            {showPreview && (
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-3 py-2 text-sm max-w-[90%] whitespace-pre-wrap leading-relaxed">
                  {previewText}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessageFlowPanel({ flowType, sampleVars }: MessageFlowPanelProps) {
  const mergedVars = { ...DEFAULT_SAMPLE_VARS, ...(sampleVars ?? {}) };

  const { data: templates, isLoading, refetch } = trpc.messageTemplates.list.useQuery({ flowType });
  const seedMutation = trpc.messageTemplates.seed.useMutation({
    onSuccess: (result) => {
      if (result.inserted > 0) {
        toast.success(`Seeded ${result.inserted} default templates`);
        refetch();
      }
    },
  });

  // Auto-seed on first load if no templates exist
  const hasTemplates = templates && templates.length > 0;
  if (!isLoading && !hasTemplates && !seedMutation.isPending) {
    seedMutation.mutate();
  }

  if (isLoading || seedMutation.isPending) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 bg-muted/40 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!templates || templates.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No templates found.
        <Button
          variant="outline"
          size="sm"
          className="ml-2"
          onClick={() => seedMutation.mutate()}
        >
          Load defaults
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Sample values note */}
      <p className="text-xs text-muted-foreground mb-4">
        Previews use sample values: <span className="font-mono">[Name] = {mergedVars["[Name]"]}</span>
        {mergedVars["[LastPrice]"] && (
          <>, <span className="font-mono">[LastPrice] = ${mergedVars["[LastPrice]"]}</span></>
        )}
        . Edit any message by clicking <strong>Edit</strong>.
      </p>

      {/* Timeline */}
      <div className="relative space-y-4">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-4 bottom-4 w-0.5 bg-border" />

        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            sampleVars={mergedVars}
            onSaved={() => refetch()}
          />
        ))}
      </div>
    </div>
  );
}
