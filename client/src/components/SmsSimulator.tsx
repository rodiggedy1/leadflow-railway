/**
 * SmsSimulator — Live SMS conversation simulator for admin/agent testing.
 *
 * Lets admins type messages as a lead and see Madison's real AI responses
 * in real time. Configurable lead context (name, service, price, extras, stage).
 * No real SMS is sent.
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Send, RotateCcw, Bot, User, ChevronDown, ChevronUp, Loader2, Smartphone } from "lucide-react";
import { EXTRAS_LIST } from "@shared/extras";

type Message = { role: "assistant" | "user"; content: string; ts: number };

type Stage = "WIDGET_SIZING" | "QUOTE_SENT" | "AVAILABILITY" | "SLOT_CHOICE" | "CONFIRMATION" | "ADDRESS" | "DONE" | "CALL_SCHEDULED";

const STAGE_LABELS: Record<Stage, string> = {
  WIDGET_SIZING: "Sizing",
  QUOTE_SENT: "Quote Sent",
  AVAILABILITY: "Availability",
  SLOT_CHOICE: "Slot Choice",
  CONFIRMATION: "Confirmation",
  ADDRESS: "Address",
  DONE: "Done",
  CALL_SCHEDULED: "Call Scheduled",
};

const STAGE_COLORS: Record<Stage, string> = {
  WIDGET_SIZING: "bg-violet-100 text-violet-700",
  QUOTE_SENT: "bg-blue-100 text-blue-700",
  AVAILABILITY: "bg-yellow-100 text-yellow-700",
  SLOT_CHOICE: "bg-orange-100 text-orange-700",
  CONFIRMATION: "bg-purple-100 text-purple-700",
  ADDRESS: "bg-indigo-100 text-indigo-700",
  DONE: "bg-green-100 text-green-700",
  CALL_SCHEDULED: "bg-teal-100 text-teal-700",
};

export default function SmsSimulator() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [showConfig, setShowConfig] = useState(true);

  // Lead context config
  const [leadName, setLeadName] = useState("Jane Smith");
  const [serviceType, setServiceType] = useState("Standard Cleaning");
  const [quotedPrice, setQuotedPrice] = useState("209");
  const [stage, setStage] = useState<Stage>("AVAILABILITY");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);

  const chatMutation = trpc.simulator.chat.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: "assistant", content: data.reply, ts: Date.now() }]);
    },
    onError: (err) => {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `⚠️ Error: ${err.message}`,
        ts: Date.now(),
      }]);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;

    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");

    chatMutation.mutate({
      message: text,
      history: newMessages.map(m => ({ role: m.role, content: m.content })),
      leadName,
      serviceType,
      quotedPrice,
      stage,
      extras: selectedExtras,
      selectedSlot: null,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleReset = () => {
    setMessages([]);
    setInput("");
  };

  const toggleExtra = (label: string) => {
    setSelectedExtras(prev =>
      prev.includes(label) ? prev.filter(e => e !== label) : [...prev, label]
    );
  };

  return (
    <div className="flex flex-col lg:flex-row gap-5 h-full">
      {/* ── Config panel ── */}
      <div className="lg:w-72 shrink-0">
        <div className="bg-white rounded-xl border p-4 space-y-4" style={{ borderColor: "#F0D8D0" }}>
          <button
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-700"
            onClick={() => setShowConfig(v => !v)}
          >
            <span className="flex items-center gap-2">
              <Smartphone className="w-4 h-4" style={{ color: "#E8603C" }} />
              Lead Context
            </span>
            {showConfig ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showConfig && (
            <div className="space-y-3 pt-1">
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Lead Name</Label>
                <Input
                  value={leadName}
                  onChange={e => setLeadName(e.target.value)}
                  placeholder="Jane Smith"
                  className="h-8 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Service Type</Label>
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Standard Cleaning">Standard Cleaning</SelectItem>
                    <SelectItem value="Deep Cleaning">Deep Cleaning</SelectItem>
                    <SelectItem value="Move-In / Move-Out">Move-In / Move-Out</SelectItem>
                    <SelectItem value="Post-Renovation Cleaning">Post-Renovation</SelectItem>
                    <SelectItem value="AirBnB Cleaning">AirBnB Cleaning</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Quoted Price ($)</Label>
                <Input
                  value={quotedPrice}
                  onChange={e => setQuotedPrice(e.target.value)}
                  placeholder="209"
                  className="h-8 text-sm"
                />
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">Conversation Stage</Label>
                <Select value={stage} onValueChange={v => setStage(v as Stage)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STAGE_LABELS) as Stage[]).map(s => (
                      <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs text-gray-500 mb-1 block">
                  Selected Extras ({selectedExtras.length})
                </Label>
                <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto">
                  {EXTRAS_LIST.map(extra => (
                    <button
                      key={extra.key}
                      onClick={() => toggleExtra(extra.label)}
                      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                        selectedExtras.includes(extra.label)
                          ? "border-orange-400 bg-orange-50 text-orange-700 font-medium"
                          : "border-gray-200 text-gray-500 hover:border-gray-300"
                      }`}
                    >
                      {extra.label}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs"
                onClick={handleReset}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Conversation
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Chat panel ── */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Phone header */}
        <div
          className="rounded-t-xl px-4 py-3 flex items-center justify-between"
          style={{ backgroundColor: "#E8603C" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-white text-sm font-semibold">Madison · Maids in Black</p>
              <p className="text-white/70 text-xs">
                Stage: <span className="font-medium">{STAGE_LABELS[stage]}</span>
                {selectedExtras.length > 0 && ` · ${selectedExtras.length} extra${selectedExtras.length > 1 ? "s" : ""}`}
              </p>
            </div>
          </div>
          <Badge className="bg-white/20 text-white border-0 text-xs">Simulator</Badge>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 border-x"
          style={{ minHeight: 320, maxHeight: 520, borderColor: "#F0D8D0" }}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <Smartphone className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-400 font-medium">Start a conversation</p>
              <p className="text-xs text-gray-400 mt-1">Type a message below to see how Madison responds</p>
              <div className="mt-4 flex flex-wrap gap-2 justify-center max-w-xs">
                {["Do you clean in Rockville?", "Are you insured?", "Why is this so expensive?", "What if I'm not happy?"].map(q => (
                  <button
                    key={q}
                    onClick={() => setInput(q)}
                    className="text-xs px-3 py-1.5 rounded-full border border-orange-200 text-orange-600 hover:bg-orange-50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: "#E8603C" }}
                >
                  <Bot className="w-3.5 h-3.5 text-white" />
                </div>
              )}
              <div
                className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-gray-200 text-gray-800 rounded-br-sm"
                    : "text-white rounded-bl-sm"
                }`}
                style={msg.role === "assistant" ? { backgroundColor: "#E8603C" } : {}}
              >
                {msg.content}
              </div>
              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-gray-300 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-gray-600" />
                </div>
              )}
            </div>
          ))}

          {chatMutation.isPending && (
            <div className="flex items-end gap-2 justify-start">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#E8603C" }}
              >
                <Bot className="w-3.5 h-3.5 text-white" />
              </div>
              <div
                className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-white text-sm"
                style={{ backgroundColor: "#E8603C" }}
              >
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          className="rounded-b-xl border-x border-b bg-white p-3 flex gap-2"
          style={{ borderColor: "#F0D8D0" }}
        >
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message as the lead..."
            className="flex-1 text-sm"
            disabled={chatMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            size="sm"
            className="gap-1.5 px-4"
            style={{ backgroundColor: "#E8603C" }}
          >
            <Send className="w-3.5 h-3.5" />
            Send
          </Button>
        </div>

        <p className="text-xs text-gray-400 mt-2 text-center">
          Real AI responses · No SMS sent · Change context in the panel to test different scenarios
        </p>
      </div>
    </div>
  );
}
