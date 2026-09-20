import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  customerFirstName?: string;
  theme?: "dark";
}

export default function InsertResponseModal({ open, onClose, onInsert, customerFirstName, theme }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { data: templates = [], isLoading } = trpc.responseTemplates.list.useQuery(undefined, {
    staleTime: 30_000,
  });

  const categories = ["All", ...Array.from(new Set(templates.map((t) => t.category))).sort()];

  const filtered = templates.filter((r) => {
    const matchesCategory = activeCategory === "All" || r.category === activeCategory;
    const q = search.toLowerCase();
    return matchesCategory && (!q || r.title.toLowerCase().includes(q) || r.message.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  });

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null;

  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveCategory("All");
      setSelectedId(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (filtered.length > 0 && !filtered.find((r) => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleInsert = () => {
    if (!selected) return;
    const firstName = customerFirstName?.trim() || "{first_name}";
    const text = selected.message.replace(/\{first_name\}/g, firstName);
    onInsert(text);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center ${theme === "dark" ? "cic-assistant-dark-backdrop" : ""}`}
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`flex flex-col ${theme === "dark" ? "cic-assistant-dark cic-response-assistant-dark" : ""}`} style={{ width: "min(1000px, 95vw)", height: "min(680px, 90vh)", background: "#fffdfb", borderRadius: "24px", overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.22)" }}>
        {/* Header */}
        <div className="cic-response-modal-header" style={{ padding: "20px 24px 16px", borderBottom: "1px solid #eee", flexShrink: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span className="cic-response-modal-title" style={{ fontSize: "18px", fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>✨ Insert Response</span>
            <button className="cic-response-modal-close" onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: "8px", padding: "6px", cursor: "pointer", color: "#6b7280" }}><X size={16} /></button>
          </div>
          <div className="relative">
            <Search size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
            <input className="cic-response-modal-search" ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search responses…" style={{ width: "100%", height: "42px", border: "1px solid #e5e7eb", borderRadius: "12px", paddingLeft: "38px", paddingRight: "14px", fontSize: "14px", outline: "none", background: "white", color: "#111827", boxSizing: "border-box" }} />
          </div>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : (
          <div className="cic-response-modal-body" style={{ flex: 1, display: "grid", gridTemplateColumns: "180px 280px 1fr", minHeight: 0 }}>
            {/* Left: categories */}
            <div className="cic-response-modal-categories" style={{ padding: "16px 12px", borderRight: "1px solid #eee", overflowY: "auto" }}>
              {categories.map((cat) => (
                <button className={`cic-response-category ${activeCategory === cat ? "is-active" : ""}`} key={cat} onClick={() => setActiveCategory(cat)} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: "10px", marginBottom: "4px", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 700, background: activeCategory === cat ? "#111827" : "transparent", color: activeCategory === cat ? "#fff" : "#374151", transition: "all 0.12s" }}>{cat}</button>
              ))}
            </div>

            {/* Middle: list */}
            <div className="cic-response-modal-list" style={{ padding: "12px", borderRight: "1px solid #eee", overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div style={{ padding: "24px 12px", color: "#9ca3af", fontSize: "13px", textAlign: "center" }}>No responses found</div>
              ) : (
                filtered.map((r) => (
                  <button className={`cic-response-template ${selected?.id === r.id ? "is-selected" : ""}`} key={r.id} onClick={() => setSelectedId(r.id)} style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", borderRadius: "14px", marginBottom: "6px", border: "none", cursor: "pointer", background: selected?.id === r.id ? "#fafafa" : "transparent", boxShadow: selected?.id === r.id ? "0 4px 16px rgba(0,0,0,0.07)" : "none", transition: "all 0.12s" }}>
                    <div className="cic-response-template-title" style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "3px" }}>{r.title}</div>
                    <div className="cic-response-template-description" style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "6px" }}>{r.description}</div>
                    <span className="cic-response-template-category" style={{ display: "inline-block", background: "#fff1e7", color: "#c2410c", padding: "3px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 800 }}>{r.category}</span>
                  </button>
                ))
              )}
            </div>

            {/* Right: preview */}
            <div className="cic-response-modal-preview" style={{ padding: "20px 24px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
              {selected && (
                <>
                  <div className="cic-response-preview-title" style={{ fontSize: "16px", fontWeight: 800, color: "#111827", marginBottom: "4px" }}>{selected.title}</div>
                  <div className="cic-response-preview-meta" style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "16px" }}>{selected.category} · Tap to insert</div>
                  <div className="cic-response-preview-message" style={{ flex: 1, background: "#fafaf9", border: "1px solid #eee", borderRadius: "14px", padding: "18px", fontSize: "14px", lineHeight: 1.65, color: "#374151", whiteSpace: "pre-wrap", overflowY: "auto" }}>{selected.message}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
                    <span style={{ fontSize: "12px", color: "#9ca3af" }}>Enter to insert</span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button className="cic-response-cancel" onClick={onClose} style={{ padding: "10px 18px", borderRadius: "12px", border: "1px solid #e5e7eb", background: "#f3f4f6", fontSize: "13px", fontWeight: 700, cursor: "pointer", color: "#374151" }}>Cancel</button>
                      <button className="cic-response-insert" onClick={handleInsert} style={{ padding: "10px 20px", borderRadius: "12px", border: "none", background: "#111827", color: "#fff", fontSize: "13px", fontWeight: 700, cursor: "pointer" }}>Insert Response</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
