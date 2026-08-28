import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, Eye, Loader2, RotateCcw, Save, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_BOOKING_WIDGET_DRAFT,
  buildDemoDetailLine,
  formatBookingButtonLabel,
  parseBookingWidgetDraft,
  renderBookingWidgetTemplate,
  resolveDemoRequest,
  type BookingWidgetDraftConfig,
  type BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";

type BookingWidgetConfigPanelProps = {
  savedValue?: string;
  onSave: (value: string) => Promise<void>;
};

type DemoStep = "request" | "bathrooms" | "extras" | "quote" | "address" | "confirm" | "complete";

type DemoSession = {
  prompt: string;
  serviceId: BookingWidgetServiceId;
  bedrooms: number;
  bathrooms: string;
  extra: string;
  address: string;
};

const fieldClass = "h-9 bg-white border-gray-200 text-sm";
const emptySession: DemoSession = {
  prompt: "",
  serviceId: "deep",
  bedrooms: 3,
  bathrooms: "",
  extra: "",
  address: "",
};

function DemoBubble({ children, customer, color }: { children: React.ReactNode; customer?: boolean; color?: string }) {
  return (
    <div
      className={`${customer ? "ml-auto rounded-[24px_24px_7px_24px]" : "rounded-[24px_24px_24px_7px] bg-white"} max-w-[86%] border border-gray-200 px-5 py-4 text-[15px] leading-7 shadow-[0_1px_2px_rgba(0,0,0,0.02)] whitespace-pre-wrap`}
      style={customer ? { backgroundColor: color } : undefined}
    >
      {children}
    </div>
  );
}

function DemoChip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full border border-gray-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-gray-800 transition hover:border-gray-300 hover:shadow-sm active:scale-[0.98]">
      {children}
    </button>
  );
}

export default function BookingWidgetConfigPanel({ savedValue, onSave }: BookingWidgetConfigPanelProps) {
  const savedConfig = useMemo(() => parseBookingWidgetDraft(savedValue), [savedValue]);
  const [config, setConfig] = useState<BookingWidgetDraftConfig>(savedConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<DemoStep>("request");
  const [demo, setDemo] = useState<DemoSession>(emptySession);
  const [composerValue, setComposerValue] = useState("");
  const conversationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConfig(savedConfig);
  }, [savedConfig]);

  useEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    requestAnimationFrame(() => element.scrollTo({ top: element.scrollHeight, behavior: "smooth" }));
  }, [step]);

  const serialized = JSON.stringify(config);
  const isDirty = serialized !== JSON.stringify(savedConfig);
  const service = config.services.find((item) => item.id === demo.serviceId) ?? config.services[1];
  const detailLine = buildDemoDetailLine(demo.bedrooms, demo.bathrooms, demo.extra);
  const stepOrder: DemoStep[] = ["request", "bathrooms", "extras", "quote", "address", "confirm", "complete"];
  const reached = (target: DemoStep) => stepOrder.indexOf(step) >= stepOrder.indexOf(target);

  const update = <K extends keyof BookingWidgetDraftConfig>(key: K, value: BookingWidgetDraftConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const updateTuple = (key: "quickPrompts" | "bathroomOptions" | "extrasOptions", index: number, value: string) => {
    const next = [...config[key]];
    next[index] = value;
    update(key, next as BookingWidgetDraftConfig[typeof key]);
  };

  const updateService = (index: number, key: Exclude<keyof BookingWidgetDraftConfig["services"][number], "id">, value: string) => {
    const next = config.services.map((item, serviceIndex) => serviceIndex === index ? { ...item, [key]: value } : item) as BookingWidgetDraftConfig["services"];
    update("services", next);
  };

  const startOver = () => {
    setStep("request");
    setDemo(emptySession);
    setComposerValue("");
    requestAnimationFrame(() => conversationRef.current?.scrollTo({ top: 0 }));
  };

  const selectRequest = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const resolved = resolveDemoRequest(trimmed);
    setDemo({ ...emptySession, prompt: trimmed, ...resolved });
    setComposerValue("");
    setStep("bathrooms");
  };

  const selectBathroom = (bathrooms: string) => {
    setDemo((current) => ({ ...current, bathrooms }));
    setComposerValue("");
    setStep("extras");
  };

  const selectExtra = (extra: string) => {
    setDemo((current) => ({ ...current, extra }));
    setComposerValue("");
    setStep("quote");
  };

  const submitAddress = (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setDemo((current) => ({ ...current, address: trimmed }));
    setComposerValue("");
    setStep("confirm");
  };

  const submitComposer = () => {
    if (step === "request") return selectRequest(composerValue);
    if (step === "bathrooms") return selectBathroom(composerValue);
    if (step === "extras") return selectExtra(composerValue);
    if (step === "address") return submitAddress(composerValue);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(serialized);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const resetToReference = () => {
    setConfig(structuredClone(DEFAULT_BOOKING_WIDGET_DRAFT));
    setSaved(false);
    startOver();
  };

  const composerPlaceholder = step === "address" || reached("confirm") ? config.addressPlaceholder : config.inputPlaceholder;
  const composerEnabled = ["request", "bathrooms", "extras", "address"].includes(step);
  const colorValue = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <p className="text-sm font-semibold text-violet-900">Fully interactive demo · internal preview only</p>
        <p className="mt-0.5 text-xs leading-relaxed text-violet-700">
          This simulation never creates a booking, processes a card, checks live availability, changes the quote form, or contacts a customer.
        </p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,430px)_minmax(560px,1fr)] xl:items-start">
        <div className="space-y-5">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-[#E8735A]" /> Brand and opening</CardTitle>
              <CardDescription>Configure the first screen of the demo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[1fr_96px] gap-3">
                <div className="space-y-1.5"><Label htmlFor="widget-brand-name">Widget title</Label><Input id="widget-brand-name" className={fieldClass} value={config.brandName} onChange={(event) => update("brandName", event.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="widget-header-icon">Icon</Label><Input id="widget-header-icon" className={fieldClass} value={config.headerIcon} onChange={(event) => update("headerIcon", event.target.value)} maxLength={8} /></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="widget-logo-url">Logo URL <span className="font-normal text-gray-400">(optional)</span></Label><Input id="widget-logo-url" className={fieldClass} placeholder="https://..." value={config.brandLogoUrl} onChange={(event) => update("brandLogoUrl", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="widget-status">Online status</Label><Input id="widget-status" className={fieldClass} value={config.statusText} onChange={(event) => update("statusText", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="widget-greeting">Opening message</Label><Textarea id="widget-greeting" className="min-h-24 resize-y bg-white border-gray-200 text-sm" value={config.greeting} onChange={(event) => update("greeting", event.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Text color</Label><div className="flex gap-2"><input type="color" aria-label="Widget text color" className="h-9 w-11 rounded border border-gray-200 bg-white p-1" value={colorValue(config.primaryColor, DEFAULT_BOOKING_WIDGET_DRAFT.primaryColor)} onChange={(event) => update("primaryColor", event.target.value)} /><Input className={fieldClass} value={config.primaryColor} onChange={(event) => update("primaryColor", event.target.value)} /></div></div>
                <div className="space-y-1.5"><Label>Accent color</Label><div className="flex gap-2"><input type="color" aria-label="Widget accent color" className="h-9 w-11 rounded border border-gray-200 bg-white p-1" value={colorValue(config.customerBubbleColor, DEFAULT_BOOKING_WIDGET_DRAFT.customerBubbleColor)} onChange={(event) => update("customerBubbleColor", event.target.value)} /><Input className={fieldClass} value={config.customerBubbleColor} onChange={(event) => update("customerBubbleColor", event.target.value)} /></div></div>
              </div>
              <div className="space-y-1.5"><Label htmlFor="widget-helper-text">Footer note</Label><Input id="widget-helper-text" className={fieldClass} value={config.helperText} onChange={(event) => update("helperText", event.target.value)} /></div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Questions and choices</CardTitle><CardDescription>Configure the request, bathroom, and extras steps.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Opening prompts</Label>{config.quickPrompts.map((value, index) => <Input key={index} aria-label={`Opening prompt ${index + 1}`} className={fieldClass} value={value} onChange={(event) => updateTuple("quickPrompts", index, event.target.value)} />)}</div>
              <div className="space-y-2"><Label htmlFor="bathroom-question">Bathroom question</Label><Input id="bathroom-question" className={fieldClass} value={config.bathroomQuestion} onChange={(event) => update("bathroomQuestion", event.target.value)} />{config.bathroomOptions.map((value, index) => <Input key={index} aria-label={`Bathroom option ${index + 1}`} className={fieldClass} value={value} onChange={(event) => updateTuple("bathroomOptions", index, event.target.value)} />)}</div>
              <div className="space-y-2"><Label htmlFor="extras-question">Extras question</Label><Input id="extras-question" className={fieldClass} value={config.extrasQuestion} onChange={(event) => update("extrasQuestion", event.target.value)} />{config.extrasOptions.map((value, index) => <Input key={index} aria-label={`Extras option ${index + 1}`} className={fieldClass} value={value} onChange={(event) => updateTuple("extrasOptions", index, event.target.value)} />)}</div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Opening and sample pricing</CardTitle><CardDescription>Demo values only; no live pricing or availability is queried.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="opening-eyebrow">Result label</Label><Input id="opening-eyebrow" className={fieldClass} value={config.openingEyebrow} onChange={(event) => update("openingEyebrow", event.target.value)} /></div>
              {config.services.map((item, index) => (
                <div key={item.id} className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{item.id}</div>
                  <div className="grid grid-cols-[1fr_90px] gap-2"><Input aria-label={`${item.id} service name`} className={fieldClass} value={item.name} onChange={(event) => updateService(index, "name", event.target.value)} /><Input aria-label={`${item.id} preview price`} className={fieldClass} value={item.price} onChange={(event) => updateService(index, "price", event.target.value)} /></div>
                  <div className="grid grid-cols-2 gap-2"><Input aria-label={`${item.id} day`} className={fieldClass} value={item.availabilityDay} onChange={(event) => updateService(index, "availabilityDay", event.target.value)} /><Input aria-label={`${item.id} time`} className={fieldClass} value={item.availabilityTime} onChange={(event) => updateService(index, "availabilityTime", event.target.value)} /></div>
                  <Input aria-label={`${item.id} provider`} className={fieldClass} value={item.providerName} onChange={(event) => updateService(index, "providerName", event.target.value)} />
                  <div className="grid grid-cols-2 gap-2"><Input aria-label={`${item.id} rating`} className={fieldClass} value={item.rating} onChange={(event) => updateService(index, "rating", event.target.value)} /><Input aria-label={`${item.id} completed jobs`} className={fieldClass} value={item.completedJobs} onChange={(event) => updateService(index, "completedJobs", event.target.value)} /></div>
                </div>
              ))}
              <div className="space-y-1.5"><Label htmlFor="widget-book-label">Continue button</Label><Input id="widget-book-label" className={fieldClass} value={config.bookingButtonLabel} onChange={(event) => update("bookingButtonLabel", event.target.value)} /><p className="text-xs text-gray-400">Use <code>{"${price}"}</code> for the demo price.</p></div>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader className="pb-3"><CardTitle className="text-base">Address, confirmation, and completion</CardTitle><CardDescription>Configure the final demo-only steps.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="address-question">Address question</Label><Input id="address-question" className={fieldClass} value={config.addressQuestion} onChange={(event) => update("addressQuestion", event.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Address input placeholder" className={fieldClass} value={config.addressPlaceholder} onChange={(event) => update("addressPlaceholder", event.target.value)} /><Input aria-label="Sample address" className={fieldClass} value={config.addressExample} onChange={(event) => update("addressExample", event.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="payment-confirmation">Payment confirmation</Label><Textarea id="payment-confirmation" className="min-h-20 bg-white border-gray-200 text-sm" value={config.paymentConfirmationTemplate} onChange={(event) => update("paymentConfirmationTemplate", event.target.value)} /><p className="text-xs text-gray-400">Tokens: <code>{"{cardBrand}"}</code> and <code>{"{last4}"}</code>.</p></div>
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Demo card brand" className={fieldClass} value={config.demoCardBrand} onChange={(event) => update("demoCardBrand", event.target.value)} /><Input aria-label="Demo card last four" className={fieldClass} value={config.demoCardLast4} onChange={(event) => update("demoCardLast4", event.target.value)} /></div>
              <Input aria-label="Confirm booking button" className={fieldClass} value={config.confirmButtonLabel} onChange={(event) => update("confirmButtonLabel", event.target.value)} />
              <div className="grid grid-cols-2 gap-2"><Input aria-label="Confirmed label" className={fieldClass} value={config.confirmedEyebrow} onChange={(event) => update("confirmedEyebrow", event.target.value)} /><Input aria-label="Confirmed title" className={fieldClass} value={config.confirmedTitle} onChange={(event) => update("confirmedTitle", event.target.value)} /></div>
              <Textarea aria-label="Confirmed schedule template" className="min-h-20 bg-white border-gray-200 text-sm" value={config.confirmedScheduleTemplate} onChange={(event) => update("confirmedScheduleTemplate", event.target.value)} />
              <Input aria-label="Demo payment notice" className={fieldClass} value={config.demoPaymentNotice} onChange={(event) => update("demoPaymentNotice", event.target.value)} />
              <Textarea aria-label="Final reminder" className="min-h-20 bg-white border-gray-200 text-sm" value={config.finalReminder} onChange={(event) => update("finalReminder", event.target.value)} />
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <Button type="button" variant="outline" className="gap-2" onClick={resetToReference}><RotateCcw className="h-4 w-4" /> Reset to reference</Button>
            <div className="flex items-center gap-3">
              {saved && <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Draft saved</span>}
              <Button type="button" className="gap-2 bg-[#E8735A] text-white hover:bg-[#d4614a]" disabled={!isDirty || saving} onClick={handleSave}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? "Saving…" : "Save draft"}</Button>
            </div>
          </div>
        </div>

        <div className="xl:sticky xl:top-[132px]">
          <Card className="overflow-hidden border-gray-200 shadow-lg">
            <CardHeader className="border-b border-gray-100 bg-white pb-3"><CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4 text-[#E8735A]" /> Interactive customer preview</CardTitle><CardDescription>Run the complete demo here. Start over resets only this preview.</CardDescription></CardHeader>
            <CardContent className="bg-[#f7f7f7] p-3 sm:p-5">
              <div className="overflow-hidden rounded-[30px] border border-gray-200 bg-[#fafafa] shadow-sm" style={{ color: config.primaryColor }}>
                <div className="flex items-center justify-between gap-4 border-b border-gray-200 bg-white px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-50 text-2xl">{config.brandLogoUrl ? <img src={config.brandLogoUrl} alt="Widget logo preview" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : config.headerIcon || <Bot className="h-5 w-5" />}</div>
                    <div className="min-w-0"><div className="truncate text-base font-bold sm:text-lg">{config.brandName || "Book with AI"}</div><div className="mt-0.5 flex items-center text-xs text-gray-500 sm:text-sm"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />{config.statusText}</div></div>
                  </div>
                  <button type="button" onClick={startOver} className="shrink-0 rounded-full border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">Start over</button>
                </div>

                <div ref={conversationRef} className="flex h-[650px] flex-col gap-5 overflow-y-auto p-4 sm:p-6">
                  <DemoBubble>{config.greeting}</DemoBubble>

                  {step === "request" && <div className="flex flex-wrap gap-2.5">{config.quickPrompts.map((prompt) => <DemoChip key={prompt} onClick={() => selectRequest(prompt)}>{prompt}</DemoChip>)}</div>}

                  {reached("bathrooms") && <DemoBubble customer color={config.customerBubbleColor}>{demo.prompt}</DemoBubble>}
                  {reached("bathrooms") && <DemoBubble>{config.bathroomQuestion}</DemoBubble>}
                  {step === "bathrooms" && <div className="flex flex-wrap gap-2.5">{config.bathroomOptions.map((option) => <DemoChip key={option} onClick={() => selectBathroom(option)}>{option}</DemoChip>)}</div>}

                  {reached("extras") && <DemoBubble customer color={config.customerBubbleColor}>{demo.bathrooms}</DemoBubble>}
                  {reached("extras") && <DemoBubble>{config.extrasQuestion}</DemoBubble>}
                  {step === "extras" && <div className="flex flex-wrap gap-2.5">{config.extrasOptions.map((option) => <DemoChip key={option} onClick={() => selectExtra(option)}>{option}</DemoChip>)}</div>}

                  {reached("quote") && <DemoBubble customer color={config.customerBubbleColor}>{demo.extra}</DemoBubble>}
                  {reached("quote") && (
                    <div className="max-w-[94%] rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-500">{config.openingEyebrow}</div>
                      <div className="mt-3 flex items-start justify-between gap-5"><div><div className="text-xl font-bold">{service.name}</div><div className="mt-1 text-sm text-gray-500">{detailLine}</div></div><div className="text-right"><div className="text-xs text-gray-500">Total</div><div className="text-2xl font-bold">${service.price || "0"}</div></div></div>
                      <div className="mt-4 rounded-xl border border-gray-200 px-4 py-3">
                        <div className="flex justify-between gap-4 text-sm"><span>📅 {service.availabilityDay}</span><strong>{service.availabilityTime}</strong></div>
                        <div className="mt-2 flex justify-between gap-4 text-sm"><span>⭐ {service.providerName}</span><strong>{service.rating}</strong></div>
                        <div className="mt-1 text-xs text-gray-500">{service.completedJobs} completed jobs · supplies included · insured</div>
                      </div>
                      <button type="button" onClick={() => step === "quote" && setStep("address")} disabled={step !== "quote"} className="mt-4 w-full rounded-xl py-3 text-sm font-bold disabled:cursor-default" style={{ backgroundColor: config.customerBubbleColor }}>{formatBookingButtonLabel(config.bookingButtonLabel, service.price)}</button>
                    </div>
                  )}

                  {reached("address") && <DemoBubble>{config.addressQuestion}</DemoBubble>}
                  {reached("confirm") && <DemoBubble customer color={config.customerBubbleColor}>{demo.address}</DemoBubble>}
                  {reached("confirm") && <DemoBubble>{renderBookingWidgetTemplate(config.paymentConfirmationTemplate, { cardBrand: config.demoCardBrand, last4: config.demoCardLast4 })}</DemoBubble>}
                  {step === "confirm" && <div><DemoChip onClick={() => setStep("complete")}>{config.confirmButtonLabel}</DemoChip></div>}

                  {step === "complete" && <DemoBubble customer color={config.customerBubbleColor}>{config.confirmButtonLabel}</DemoBubble>}
                  {step === "complete" && (
                    <div className="max-w-[94%] rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="text-xs font-bold uppercase tracking-[0.08em] text-emerald-600">{config.confirmedEyebrow}</div>
                      <div className="mt-3 text-xl font-bold">{config.confirmedTitle}</div>
                      <div className="mt-3 text-sm leading-6 text-gray-600">{renderBookingWidgetTemplate(config.confirmedScheduleTemplate, { providerName: service.providerName, day: service.availabilityDay, time: service.availabilityTime })}</div>
                      <div className="mt-4 space-y-2 rounded-xl border border-gray-200 p-4 text-sm">
                        <div className="flex justify-between gap-4"><span>{service.name}</span><strong>${service.price}</strong></div>
                        <div className="flex justify-between gap-4 text-gray-500"><span>Address</span><span className="text-right">{demo.address}</span></div>
                        <div className="flex justify-between gap-4 text-gray-500"><span>Payment</span><span>•••• {config.demoCardLast4}</span></div>
                      </div>
                      <p className="mt-4 text-xs text-gray-500">{config.demoPaymentNotice}</p>
                    </div>
                  )}
                  {step === "complete" && <DemoBubble>{config.finalReminder}</DemoBubble>}
                </div>

                <form onSubmit={(event) => { event.preventDefault(); submitComposer(); }} className="border-t border-gray-200 bg-white p-4">
                  <div className="flex gap-2">
                    <Input value={composerValue} onChange={(event) => setComposerValue(event.target.value)} disabled={!composerEnabled} placeholder={composerPlaceholder} aria-label="Demo booking response" className="h-14 rounded-2xl border-gray-200 bg-white px-4 text-base disabled:cursor-default disabled:opacity-100" />
                    <button type="submit" aria-label="Send demo response" disabled={!composerEnabled || !composerValue.trim()} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl disabled:cursor-default" style={{ backgroundColor: config.customerBubbleColor }}><Send className="h-5 w-5" /></button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{config.helperText}</p>
                </form>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
