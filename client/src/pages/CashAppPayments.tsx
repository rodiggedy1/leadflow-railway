import { FormEvent, useState } from "react";
import { Check, Copy, DollarSign, Loader2, Send, User, Phone } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function CashAppPayments() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("Cleaning service payment");
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const generate = trpc.cashApp.generateLink.useMutation({ onSuccess: (data) => { setLink(data); toast.success("Cash App payment link created."); }, onError: (error) => toast.error(error.message) });

  function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents < 50) { toast.error("Enter an amount of at least $0.50."); return; }
    generate.mutate({ customerPhone: phone, customerName: name || undefined, amountCents, description });
  }

  async function copyLink() { if (!link) return; await navigator.clipboard.writeText(link.url); toast.success("Link copied."); }

  return <main className="min-h-screen bg-[#f7f5f0] p-6 text-[#111827]"><div className="mx-auto max-w-2xl"><div className="mb-8"><p className="text-xs font-black uppercase tracking-[.18em] text-amber-700">Separate Cash App Pay workflow</p><h1 className="mt-2 text-3xl font-black tracking-tight">Create a payment link</h1><p className="mt-2 text-sm text-slate-500">This creates an immediate, fixed-amount Cash App payment. It does not modify card-on-file links.</p></div><form onSubmit={submit} className="grid gap-4 rounded-3xl border border-white bg-white p-6 shadow-xl"><label className="grid gap-2 text-sm font-bold"><span className="flex items-center gap-2"><Phone size={15} />Customer phone *</span><input required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1 (555) 000-0000" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-900" /></label><label className="grid gap-2 text-sm font-bold"><span className="flex items-center gap-2"><User size={15} />Customer name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Jane Smith" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-900" /></label><label className="grid gap-2 text-sm font-bold"><span className="flex items-center gap-2"><DollarSign size={15} />Amount *</span><input required inputMode="decimal" min="0.50" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="150.00" className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-900" /></label><label className="grid gap-2 text-sm font-bold"><span>Description *</span><input required value={description} onChange={(event) => setDescription(event.target.value)} className="rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-slate-900" /></label><button type="submit" disabled={generate.isPending} className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-black text-white disabled:opacity-60">{generate.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}Create Cash App link</button></form>{link && <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-2 font-black text-emerald-800"><Check size={17} />Link ready</div><p className="mt-2 break-all rounded-xl bg-white p-3 font-mono text-xs text-slate-700">{link.url}</p><div className="mt-3 flex gap-2"><button type="button" onClick={copyLink} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white"><Copy size={15} />Copy link</button><a href={link.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black">Open page</a></div><p className="mt-3 text-xs text-emerald-800">Expires {new Date(link.expiresAt).toLocaleString()}.</p></section>}</div></main>;
}
