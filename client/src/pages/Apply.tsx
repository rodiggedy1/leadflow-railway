/**
 * Apply — Public-facing multi-step cleaner application form
 * Steps: Welcome → Basic Info → Requirements → Specialties → Your Bio → Video → Thank You
 * World-class design: clean white layout, green accent, soft shadows, MIB brand feel.
 */
import React, { useState, useRef } from "react";
import {
  Home,
  User,
  CheckSquare,
  Grid,
  Camera,
  Video,
  MapPin,
  Mail,
  Phone,
  ChevronRight,
  CloudUpload,
  Sparkles,
  CheckCircle2,
  PhoneCall,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = "welcome" | "basic-info" | "requirements" | "specialties" | "bio" | "video" | "done";

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  streetAddress: string;
  apt: string;
  city: string;
  state: string;
  zip: string;
  hasCleaning: boolean | null;
  hasBankAccount: boolean | null;
  isAuthorized: boolean | null;
  consentBackground: boolean | null;
  experience: string;
  specialties: string[];
  bioPhoto: File | null;
  videoFile: File | null;
}

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: "welcome", label: "Welcome", icon: <Home size={16} /> },
  { id: "basic-info", label: "Basic Info", icon: <User size={16} /> },
  { id: "requirements", label: "Requirements", icon: <CheckSquare size={16} /> },
  { id: "specialties", label: "Specialties", icon: <Grid size={16} /> },
  { id: "bio", label: "Your Bio", icon: <Camera size={16} /> },
  { id: "video", label: "Video", icon: <Video size={16} /> },
  { id: "done", label: "address", icon: <MapPin size={16} /> },
];

const STEP_ORDER: Step[] = ["welcome", "basic-info", "requirements", "specialties", "bio", "video", "done"];

const SPECIALTIES = [
  "Pro Residential Cleaning",
  "Commercial Cleaning",
  "Hotel Cleaning",
  "Move in/Move Out",
  "Office Cleaning",
  "Post Construction",
  "Window Cleaning",
  "Airbnb Cleaning",
  "Eco-Friendly Cleaning",
  "Medical Facility Cleaning",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","MD","VA",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const GREEN = "#16a34a";
const GREEN_LIGHT = "#f0fdf4";
const GREEN_MID = "#dcfce7";
const ACCENT = "#2563eb";

function stepIndex(step: Step) {
  return STEP_ORDER.indexOf(step);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function YesNoField({
  question,
  value,
  onChange,
}: {
  question: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mb-6">
      <p className="text-sm font-medium text-gray-700 mb-2">{question}</p>
      <div className="grid grid-cols-2 gap-3">
        {[true, false].map(opt => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className="h-14 rounded-xl border text-sm font-semibold transition-all"
            style={
              value === opt
                ? { borderColor: GREEN, backgroundColor: GREEN_LIGHT, color: GREEN }
                : { borderColor: "#e5e7eb", backgroundColor: "#fff", color: "#111827" }
            }
          >
            {opt ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </div>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  icon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="relative">
        {icon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</span>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full h-12 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
          style={{ paddingLeft: icon ? 36 : 14, paddingRight: 14 }}
        />
      </div>
    </div>
  );
}

// ── Step screens ───────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="max-w-2xl">
      {/* Video placeholder */}
      <div
        className="relative rounded-2xl overflow-hidden mb-8 cursor-pointer group"
        style={{ background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)", aspectRatio: "16/9" }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className="w-16 h-16 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110"
            style={{ backgroundColor: GREEN }}
          >
            <ChevronRight size={28} color="#fff" style={{ marginLeft: 4 }} />
          </div>
          <p className="text-white text-sm font-medium opacity-80">Watch our welcome message</p>
        </div>
        {/* Decorative gradient overlay */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent)" }}
        />
        <div className="absolute bottom-3 left-4 right-4 flex items-center gap-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: GREEN }}>
            <ChevronRight size={12} color="#fff" style={{ marginLeft: 1 }} />
          </div>
          <div className="flex-1 h-1 rounded-full bg-white/20">
            <div className="h-full w-[8%] rounded-full" style={{ backgroundColor: GREEN }} />
          </div>
          <span className="text-white text-xs">0:12</span>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">Cleaning Professional Application</h1>
      <p className="text-gray-500 mb-8 leading-relaxed">
        Join our team of top-rated cleaning professionals. This application takes about 5–10 minutes
        and will help us match you with the right clients.
      </p>

      {/* Perks */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {[
          { emoji: "💰", title: "Competitive Pay", desc: "Earn $18–$28/hr" },
          { emoji: "📅", title: "Flexible Hours", desc: "Set your own schedule" },
          { emoji: "🌟", title: "Top Clients", desc: "Premium households" },
        ].map(p => (
          <div
            key={p.title}
            className="rounded-2xl p-4 text-center"
            style={{ backgroundColor: GREEN_LIGHT, border: `1px solid ${GREEN_MID}` }}
          >
            <div className="text-2xl mb-1">{p.emoji}</div>
            <p className="text-xs font-semibold text-gray-800">{p.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{p.desc}</p>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="flex items-center gap-2 h-13 px-8 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90 active:scale-[0.98]"
        style={{ backgroundColor: GREEN, height: 52 }}
      >
        Start Application
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

function BasicInfoStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Tell us about yourself</h2>
      <p className="text-sm text-gray-400 mb-8">Basic contact and address information</p>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <InputField
          label="First Name"
          placeholder="Enter your first name"
          value={data.firstName}
          onChange={v => onChange({ firstName: v })}
        />
        <InputField
          label="Last Name"
          placeholder="Enter your last name"
          value={data.lastName}
          onChange={v => onChange({ lastName: v })}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <InputField
          label="Email Address"
          placeholder="Enter your email"
          type="email"
          value={data.email}
          onChange={v => onChange({ email: v })}
          icon={<Mail size={15} />}
        />
        <InputField
          label="Phone Number"
          placeholder="302-123-4567"
          type="tel"
          value={data.phone}
          onChange={v => onChange({ phone: v })}
          icon={<Phone size={15} />}
        />
      </div>

      <div className="mb-1">
        <h3 className="text-base font-bold text-gray-900 mb-4">Address</h3>
        <div className="grid grid-cols-[1fr_160px] gap-4 mb-4">
          <InputField
            label="Street Address"
            placeholder="123 Main St"
            value={data.streetAddress}
            onChange={v => onChange({ streetAddress: v })}
          />
          <InputField
            label="Apt/Suite"
            placeholder="Apt 4B"
            value={data.apt}
            onChange={v => onChange({ apt: v })}
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <InputField
            label="City"
            placeholder="Phoenix"
            value={data.city}
            onChange={v => onChange({ city: v })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">State/Province</label>
            <select
              value={data.state}
              onChange={e => onChange({ state: e.target.value })}
              className="w-full h-12 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 outline-none px-3 transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">Select</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <InputField
            label="ZIP/Postal Code"
            placeholder="e.g., 85001"
            value={data.zip}
            onChange={v => onChange({ zip: v })}
          />
        </div>
      </div>

      <div className="flex justify-end mt-8">
        <button
          onClick={onNext}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function RequirementsStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Requirements</h2>
      <p className="text-sm text-gray-400 mb-8">Please answer all questions honestly</p>

      <YesNoField
        question="Do you have professional cleaning experience?"
        value={data.hasCleaning}
        onChange={v => onChange({ hasCleaning: v })}
      />
      <YesNoField
        question="Do you have a bank account for direct deposit?"
        value={data.hasBankAccount}
        onChange={v => onChange({ hasBankAccount: v })}
      />
      <YesNoField
        question="Are you legally authorized to work in the United States?"
        value={data.isAuthorized}
        onChange={v => onChange({ isAuthorized: v })}
      />
      <YesNoField
        question="Do you consent to a background check?"
        value={data.consentBackground}
        onChange={v => onChange({ consentBackground: v })}
      />

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Tell us about your professional cleaning experience
        </label>
        <textarea
          rows={4}
          placeholder="Describe your experience, types of properties cleaned, years of experience..."
          value={data.experience}
          onChange={e => onChange({ experience: e.target.value })}
          className="w-full rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-900 p-3 outline-none resize-none transition-all focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function SpecialtiesStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const toggle = (s: string) => {
    const next = data.specialties.includes(s)
      ? data.specialties.filter(x => x !== s)
      : [...data.specialties, s];
    onChange({ specialties: next });
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Specialties</h2>
      <p className="text-sm text-gray-400 mb-2">Select all that apply</p>

      {/* Selection counter */}
      <div className="flex items-center gap-2 mb-6">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold"
            style={{
              backgroundColor: data.specialties.length > i ? GREEN : "#e5e7eb",
              color: data.specialties.length > i ? "#fff" : "#9ca3af",
            }}
          >
            {i + 1}
          </div>
        ))}
        <span className="text-sm text-gray-400">{data.specialties.length}/3+ selected</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        {SPECIALTIES.map(s => {
          const selected = data.specialties.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className="h-14 rounded-xl border text-sm font-medium text-left px-4 transition-all"
              style={
                selected
                  ? { borderColor: GREEN, backgroundColor: GREEN_LIGHT, color: GREEN, fontWeight: 600 }
                  : { borderColor: "#e5e7eb", backgroundColor: "#fff", color: "#111827" }
              }
            >
              {s}
            </button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function BioStep({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFile = (file: File) => {
    onChange({ bioPhoto: file });
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Bio</h2>
      <p className="text-sm text-gray-400 mb-8">Upload a professional photo — this helps clients connect with you</p>

      <div className="flex flex-col items-center mb-8">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative rounded-full flex items-center justify-center transition-all hover:opacity-90 group"
          style={{
            width: 200,
            height: 200,
            border: `2px dashed ${preview ? GREEN : "#d1d5db"}`,
            backgroundColor: preview ? "transparent" : "#f9fafb",
            overflow: "hidden",
          }}
        >
          {preview ? (
            <img src={preview} alt="Bio" className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <CloudUpload size={36} color="#9ca3af" />
              <span className="text-sm text-gray-400 font-medium">Click to upload</span>
              <span className="text-xs text-gray-300">JPG, PNG up to 10MB</span>
            </div>
          )}
          {preview && (
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-sm font-medium">Change photo</span>
            </div>
          )}
        </button>

        {preview && (
          <p className="mt-3 text-sm font-medium" style={{ color: GREEN }}>
            ✓ Photo uploaded
          </p>
        )}
      </div>

      <div
        className="rounded-2xl p-4 mb-8 flex gap-3"
        style={{ backgroundColor: GREEN_LIGHT, border: `1px solid ${GREEN_MID}` }}
      >
        <Sparkles size={18} color={GREEN} className="shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-gray-800 mb-1">Tips for a great photo</p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• Use good lighting — natural light works best</li>
            <li>• Wear professional attire (uniform if you have one)</li>
            <li>• Smile and look directly at the camera</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function VideoStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Video</h2>

      <div className="grid grid-cols-[1fr_1fr] gap-5">
        {/* Left: prompt + tips */}
        <div className="space-y-4">
          {/* Prompt card */}
          <div
            className="rounded-2xl p-5"
            style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
              >
                <Sparkles size={18} color="#fff" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">Your Moment to Shine</p>
                <p className="text-xs text-gray-400">Take 60 seconds to showcase your expertise</p>
              </div>
            </div>
            <div className="border-l-4 pl-4" style={{ borderColor: "#7c3aed" }}>
              <p className="text-sm font-semibold text-gray-800 leading-relaxed">
                Tell us about a time when you had to solve a complex problem at work. What was your approach, and what was the outcome?
              </p>
            </div>
          </div>

          {/* Pro tips */}
          <div
            className="rounded-2xl p-4"
            style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: GREEN_LIGHT }}
              >
                <CheckCircle2 size={16} color={GREEN} />
              </div>
              <p className="text-sm font-bold text-gray-900">Pro Tips</p>
            </div>
            <ul className="space-y-2">
              {[
                "Maintain eye contact with the camera",
                "Use the STAR method (Situation, Task, Action, Result)",
                "Speak with confidence and enthusiasm",
              ].map(tip => (
                <li key={tip} className="flex items-start gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                    style={{ backgroundColor: GREEN }}
                  />
                  <span className="text-xs text-gray-500">{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: camera preview */}
        <div>
          <div
            className="rounded-2xl flex flex-col items-center justify-center mb-4"
            style={{
              background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
              aspectRatio: "4/3",
              position: "relative",
            }}
          >
            <div
              className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full"
              style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
            >
              <span className="text-white text-xs">⏱</span>
              <span className="text-white text-xs font-semibold">1:00</span>
            </div>
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
            >
              <Camera size={28} color="rgba(255,255,255,0.7)" />
            </div>
            <p className="text-white text-sm font-semibold">Ready to record?</p>
            <p className="text-white/50 text-xs mt-1">Your camera will activate when you start</p>
          </div>

          <button
            className="w-full h-12 rounded-2xl text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90 mb-2"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4f46e5)" }}
          >
            <ChevronRight size={18} />
            Start Recording
          </button>
          <p className="text-center text-xs text-gray-400">
            Ensure your camera and microphone permissions are enabled
          </p>
        </div>
      </div>

      <div className="flex justify-between items-center mt-6">
        <button
          onClick={onNext}
          className="flex items-center gap-2 h-12 px-7 rounded-2xl text-white font-semibold text-sm transition-all hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Continue <ChevronRight size={16} />
        </button>
        <button
          onClick={onNext}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Record Later
        </button>
      </div>
    </div>
  );
}

function ThankYouStep() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div
        className="rounded-3xl p-10 text-center max-w-sm w-full"
        style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 4px 24px rgba(0,0,0,0.07)" }}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{ backgroundColor: GREEN_LIGHT }}
        >
          <CheckCircle2 size={32} color={GREEN} />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h2>
        <p className="text-gray-500 text-sm mb-4">Your application has been successfully submitted.</p>

        {/* Green divider */}
        <div className="w-12 h-1 rounded-full mx-auto mb-6" style={{ backgroundColor: GREEN }} />

        {/* Status items */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-center gap-2">
            <Mail size={16} color={GREEN} />
            <span className="text-sm text-gray-700">Application received</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <PhoneCall size={16} color={GREEN} />
            <span className="text-sm text-gray-700">Interview coming soon</span>
          </div>
        </div>

        {/* Info box */}
        <div
          className="rounded-2xl p-4 mb-6"
          style={{ backgroundColor: GREEN_LIGHT, border: `1px solid ${GREEN_MID}` }}
        >
          <p className="text-sm text-gray-700 leading-relaxed">
            Someone from our team will be in touch shortly to discuss the next steps in the process.
          </p>
        </div>

        <p className="text-xs text-gray-400">We appreciate your interest in joining our team</p>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Apply() {
  const [step, setStep] = useState<Step>("welcome");
  const [formData, setFormData] = useState<FormData>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    streetAddress: "",
    apt: "",
    city: "",
    state: "",
    zip: "",
    hasCleaning: null,
    hasBankAccount: null,
    isAuthorized: null,
    consentBackground: null,
    experience: "",
    specialties: [],
    bioPhoto: null,
    videoFile: null,
  });

  const patch = (p: Partial<FormData>) => setFormData(prev => ({ ...prev, ...p }));
  const next = () => {
    const idx = stepIndex(step);
    if (idx < STEP_ORDER.length - 1) setStep(STEP_ORDER[idx + 1]);
  };

  const isDone = step === "done";
  const currentIdx = stepIndex(step);

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#f8fafc" }}>
      {/* ── Left sidebar nav ── */}
      {!isDone && (
        <aside
          className="w-60 shrink-0 flex flex-col py-8 px-4"
          style={{ backgroundColor: "#fff", borderRight: "1px solid #f1f5f9" }}
        >
          {/* Logo */}
          <div className="flex items-center gap-2 px-2 mb-10">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: GREEN }}
            >
              <span className="text-white text-xs font-bold">MIB</span>
            </div>
            <span className="text-sm font-semibold text-gray-800">Apply Now</span>
          </div>

          <nav className="space-y-1">
            {STEPS.filter(s => s.id !== "done").map((s, i) => {
              const isActive = s.id === step;
              const isCompleted = i < currentIdx;
              return (
                <button
                  key={s.id}
                  onClick={() => isCompleted && setStep(s.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left"
                  style={
                    isActive
                      ? { backgroundColor: "#eff6ff", color: ACCENT }
                      : isCompleted
                      ? { color: GREEN, cursor: "pointer" }
                      : { color: "#9ca3af", cursor: "default" }
                  }
                >
                  <span
                    className="flex items-center justify-center w-5 h-5"
                    style={{ color: isActive ? ACCENT : isCompleted ? GREEN : "#9ca3af" }}
                  >
                    {isCompleted ? <CheckCircle2 size={16} /> : s.icon}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </nav>

          {/* Progress bar */}
          <div className="mt-auto px-2">
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Progress</span>
              <span>{Math.round((currentIdx / (STEP_ORDER.length - 1)) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(currentIdx / (STEP_ORDER.length - 1)) * 100}%`,
                  backgroundColor: GREEN,
                }}
              />
            </div>
          </div>
        </aside>
      )}

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className={isDone ? "w-full" : "max-w-3xl px-10 py-10"}>
          {step === "welcome" && <WelcomeStep onNext={next} />}
          {step === "basic-info" && <BasicInfoStep data={formData} onChange={patch} onNext={next} />}
          {step === "requirements" && <RequirementsStep data={formData} onChange={patch} onNext={next} />}
          {step === "specialties" && <SpecialtiesStep data={formData} onChange={patch} onNext={next} />}
          {step === "bio" && <BioStep data={formData} onChange={patch} onNext={next} />}
          {step === "video" && <VideoStep onNext={next} />}
          {step === "done" && <ThankYouStep />}
        </div>
      </main>
    </div>
  );
}
