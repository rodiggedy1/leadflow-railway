import { useState, useEffect, useRef } from "react";
import { X, Search } from "lucide-react";

interface Response {
  title: string;
  category: string;
  description: string;
  message: string;
}

const RESPONSES: Response[] = [
  {
    title: "Card on File",
    category: "Payments",
    description: "Reserve the appointment",
    message:
      "Hi {first_name}! To reserve your cleaning appointment, we simply place a card on file. Nothing is charged until after your cleaning has been completed. We use Stripe for secure payment processing, and your card information is never stored on our system. Once that's taken care of, your reservation is fully secured.",
  },
  {
    title: "Booking Confirmation",
    category: "Scheduling",
    description: "Confirm the appointment",
    message:
      "Great news! 🎉 Your cleaning has been confirmed for {date}. We'll send you a reminder before your appointment, and if anything changes we'll reach out right away. If you have any questions before then, just reply to this message.",
  },
  {
    title: "Arrival Delay",
    category: "Scheduling",
    description: "Cleaner is running late",
    message:
      "Hi {first_name}! I wanted to give you a quick update. Our team is running about {minutes} minutes behind because the previous home took a little longer than expected. We sincerely appreciate your patience and will get to you as quickly as possible.",
  },
  {
    title: "On the Way",
    category: "Scheduling",
    description: "Cleaner has left",
    message:
      "Hi {first_name}! Your cleaning team is on the way and should arrive in approximately {eta}. Looking forward to taking great care of your home today!",
  },
  {
    title: "Access Instructions",
    category: "Scheduling",
    description: "Need entry information",
    message:
      "Hi! Before we head out, could you let us know the best way to access the home? Whether it's a door code, lockbox, concierge, or someone meeting us there, we'll make sure everything goes smoothly.",
  },
  {
    title: "Cleaning Complete",
    category: "Scheduling",
    description: "Service finished",
    message:
      "Your cleaning is complete! 🎉 Thank you for trusting Maid in Black with your home. If anything isn't exactly how you expected, just let us know within 24 hours and we'll make it right.",
  },
  {
    title: "Review Request",
    category: "Reviews",
    description: "Ask for a review",
    message:
      "Thank you again for choosing Maid in Black! If you were happy with today's cleaning, we'd truly appreciate a quick review. It really helps our small business grow and means a lot to our team.",
  },
  {
    title: "Refund Apology",
    category: "Refunds",
    description: "Own the mistake",
    message:
      "I'm truly sorry we let you down. We've processed your refund, and I'm also reviewing what happened with our team so we can make sure this doesn't happen again. Thank you for giving us the opportunity to make it right.",
  },
  {
    title: "Free Reclean",
    category: "Refunds",
    description: "Offer a return visit",
    message:
      "Thank you for letting us know. We'd love the opportunity to make this right. We'll send a team back at no charge to address the areas that missed the mark. Our goal is for you to be completely happy with the service.",
  },
  {
    title: "No Availability",
    category: "Scheduling",
    description: "Fully booked",
    message:
      "Thank you so much for reaching out! Unfortunately we're fully booked for the dates you requested. The earliest availability we currently have is {next_available_date}. If that works for you, I'd be happy to reserve it.",
  },
  {
    title: "Move-Out Quote",
    category: "Payments",
    description: "Explain pricing",
    message:
      "For a move-out cleaning of a {bedrooms}-bedroom, {bathrooms}-bathroom home, most customers fall around {price} depending on the condition of the property and any add-ons like inside the oven, refrigerator, or cabinets.",
  },
  {
    title: "Follow-up (No Response)",
    category: "Follow-up",
    description: "Customer went silent",
    message:
      "Hi {first_name}! Just checking in to see if you're still looking for a cleaning. If you have any questions or you'd like to get something scheduled, just reply here—I'm happy to help.",
  },
  {
    title: "Recurring Cleaning",
    category: "Follow-up",
    description: "Convert one-time customers",
    message:
      "We also offer recurring cleanings, which many of our customers love because it's more convenient and usually less expensive per visit. If you'd like, I can send over pricing for every 2 weeks or every 4 weeks.",
  },
  {
    title: "Thank You",
    category: "Follow-up",
    description: "Simple appreciation",
    message:
      "Thank you for choosing Maid in Black! We truly appreciate the opportunity to earn your business. If you ever need anything at all, just reply here—our team is always happy to help.",
  },
];

const CATEGORIES = ["All", "Scheduling", "Payments", "Refunds", "Reviews", "Follow-up"];

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
  customerFirstName?: string;
}

export default function InsertResponseModal({ open, onClose, onInsert, customerFirstName }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selected, setSelected] = useState<Response>(RESPONSES[0]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setActiveCategory("All");
      setSelected(RESPONSES[0]);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const filtered = RESPONSES.filter((r) => {
    const matchesCategory = activeCategory === "All" || r.category === activeCategory;
    const q = search.toLowerCase();
    const matchesSearch = !q || r.title.toLowerCase().includes(q) || r.message.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  // Keep selected in sync when filter changes
  useEffect(() => {
    if (filtered.length > 0 && !filtered.includes(selected)) {
      setSelected(filtered[0]);
    }
  }, [filtered]);

  const handleInsert = () => {
    const firstName = customerFirstName?.trim() || "{first_name}";
    const text = selected.message.replace(/\{first_name\}/g, firstName);
    onInsert(text);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col"
        style={{
          width: "min(1000px, 95vw)",
          height: "min(680px, 90vh)",
          background: "#fffdfb",
          borderRadius: "24px",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.22)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #eee", flexShrink: 0 }}>
          <div className="flex items-center justify-between mb-3">
            <span style={{ fontSize: "18px", fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>
              ✨ Insert Response
            </span>
            <button
              onClick={onClose}
              style={{ background: "#f3f4f6", border: "none", borderRadius: "8px", padding: "6px", cursor: "pointer", color: "#6b7280" }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="relative">
            <Search size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "#9ca3af" }} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search responses…"
              style={{
                width: "100%",
                height: "42px",
                border: "1px solid #e5e7eb",
                borderRadius: "12px",
                paddingLeft: "38px",
                paddingRight: "14px",
                fontSize: "14px",
                outline: "none",
                background: "white",
                color: "#111827",
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "180px 280px 1fr", minHeight: 0 }}>
          {/* Left: categories */}
          <div style={{ padding: "16px 12px", borderRight: "1px solid #eee", overflowY: "auto" }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  marginBottom: "4px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: 700,
                  background: activeCategory === cat ? "#111827" : "transparent",
                  color: activeCategory === cat ? "#fff" : "#374151",
                  transition: "all 0.12s",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Middle: list */}
          <div style={{ padding: "12px", borderRight: "1px solid #eee", overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "24px 12px", color: "#9ca3af", fontSize: "13px", textAlign: "center" }}>No responses found</div>
            ) : (
              filtered.map((r) => (
                <button
                  key={r.title}
                  onClick={() => setSelected(r)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: "14px",
                    marginBottom: "6px",
                    border: "none",
                    cursor: "pointer",
                    background: selected === r ? "#fafafa" : "transparent",
                    boxShadow: selected === r ? "0 4px 16px rgba(0,0,0,0.07)" : "none",
                    transition: "all 0.12s",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#111827", marginBottom: "3px" }}>{r.title}</div>
                  <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "6px" }}>{r.description}</div>
                  <span
                    style={{
                      display: "inline-block",
                      background: "#fff1e7",
                      color: "#c2410c",
                      padding: "3px 8px",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 800,
                    }}
                  >
                    {r.category}
                  </span>
                </button>
              ))
            )}
          </div>

          {/* Right: preview */}
          <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {selected && (
              <>
                <div style={{ fontSize: "16px", fontWeight: 800, color: "#111827", marginBottom: "4px" }}>{selected.title}</div>
                <div style={{ fontSize: "12px", color: "#9ca3af", marginBottom: "16px" }}>{selected.category} · Tap to insert</div>
                <div
                  style={{
                    flex: 1,
                    background: "#fafaf9",
                    border: "1px solid #eee",
                    borderRadius: "14px",
                    padding: "18px",
                    fontSize: "14px",
                    lineHeight: 1.65,
                    color: "#374151",
                    whiteSpace: "pre-wrap",
                    overflowY: "auto",
                  }}
                >
                  {selected.message}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
                  <span style={{ fontSize: "12px", color: "#9ca3af" }}>Enter to insert</span>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={onClose}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "12px",
                        border: "1px solid #e5e7eb",
                        background: "#f3f4f6",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                        color: "#374151",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleInsert}
                      style={{
                        padding: "10px 20px",
                        borderRadius: "12px",
                        border: "none",
                        background: "#111827",
                        color: "#fff",
                        fontSize: "13px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Insert Response
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
