import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import BookingExperience from "./BookingExperience";

export default function BookWithAIWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#111] px-5 py-3 text-sm font-extrabold text-white shadow-[0_18px_45px_rgba(17,17,17,0.25)] transition hover:bg-[#ff684c] focus:outline-none focus:ring-2 focus:ring-[#ff684c] focus:ring-offset-2" aria-label="Open Book with AI">
        <Sparkles className="h-4 w-4" /> Book with AI
      </button>
      {open && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 p-2 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label="Book with AI">
        <div className="relative h-[min(860px,calc(100dvh-1rem))] w-full max-w-[780px] overflow-hidden rounded-[30px] bg-white shadow-[0_35px_110px_rgba(0,0,0,0.42)] sm:h-[min(860px,calc(100dvh-2.5rem))]">
          <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 z-[95] grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-black/60 text-white transition hover:bg-black/80" aria-label="Close Book with AI"><X className="h-5 w-5" /></button>
          <div className="h-full overflow-auto"><BookingExperience surface="popup" /></div>
        </div>
      </div>}
    </>
  );
}
