/**
 * QuoteForm Component
 * Design: Warm Coral Hospitality — Playfair Display headlines, DM Sans body
 * Colors: Coral #E8603C, Warm bg #FFF8F5, Input bg #FFF0EC
 * Features: Staggered entrance, coral focus rings, success state with bounce animation
 * Backend: tRPC quotes.submit → OpenPhone SMS
 */

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const SERVICE_TYPES = [
  "Standard Cleaning",
  "Deep Cleaning",
  "Move-In / Move-Out Cleaning",
  "Post-Construction Cleaning",
  "Office Cleaning",
  "Recurring Service",
];

const BEDROOM_OPTIONS = [
  "Studio",
  "1 Bedroom",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
];

const BATHROOM_OPTIONS = [
  "1 Bathroom",
  "1.5 Bathrooms",
  "2 Bathrooms",
  "2.5 Bathrooms",
  "3 Bathrooms",
  "3.5+ Bathrooms",
];

interface FormData {
  name: string;
  email: string;
  phone: string;
  serviceType: string;
  bedrooms: string;
  bathrooms: string;
}

const INITIAL_FORM: FormData = {
  name: "",
  email: "",
  phone: "",
  serviceType: "Standard Cleaning",
  bedrooms: "1 Bedroom",
  bathrooms: "1 Bathroom",
};

function StarRating() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          className="animate-star"
          style={{ animationDelay: `${500 + i * 80}ms` }}
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="#F5A623"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
      <span
        className="animate-fade-slide-up delay-7 ml-1 text-sm font-semibold"
        style={{ color: "#8A6040", fontFamily: "'DM Sans', sans-serif" }}
      >
        5 Stars
      </span>
    </div>
  );
}

function SuccessState({ name, smsSent }: { name: string; smsSent: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center animate-fade-slide-up delay-0">
      <div
        className="animate-success w-20 h-20 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, #E8603C 0%, #D44E2A 100%)" }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2
        className="text-2xl font-bold mb-3"
        style={{ fontFamily: "'Playfair Display', serif", color: "#2D2D2D" }}
      >
        Quote Request Sent!
      </h2>
      <p className="text-base mb-2" style={{ color: "#6B4A3A", fontFamily: "'DM Sans', sans-serif" }}>
        Thanks{name ? `, ${name.split(" ")[0]}` : ""}! We've received your request.
      </p>
      {smsSent ? (
        <p className="text-sm" style={{ color: "#B07060", fontFamily: "'DM Sans', sans-serif" }}>
          Check your phone — your custom quote was just texted to you from Maids in Black!
        </p>
      ) : (
        <p className="text-sm" style={{ color: "#B07060", fontFamily: "'DM Sans', sans-serif" }}>
          Our team will be in touch with your custom quote shortly.
        </p>
      )}
    </div>
  );
}

export default function QuoteForm() {
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<Partial<FormData>>({});
  const [submitted, setSubmitted] = useState(false);
  const [smsSent, setSmsSent] = useState(false);

  const submitMutation = trpc.quotes.submit.useMutation({
    onSuccess: (data) => {
      setSmsSent(data.smsSent);
      setSubmitted(true);
      if (!data.smsSent) {
        toast.warning("Quote received! We'll follow up shortly.");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Something went wrong. Please try again.");
    },
  });

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.email.trim()) {
      newErrors.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      newErrors.email = "Enter a valid email";
    }
    if (!form.phone.trim()) {
      newErrors.phone = "Phone number is required";
    } else if (!/^\+?[\d\s\-().]{7,}$/.test(form.phone)) {
      newErrors.phone = "Enter a valid phone number";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    submitMutation.mutate(form);
  };

  const isSubmitting = submitMutation.isPending;

  return (
    <div
      className="w-full min-h-screen flex items-center justify-center p-4 sm:p-8"
      style={{
        backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/quote-form-bg-CanHy7qWKMuuprbsFjqUZ3.webp)`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#FFF8F5",
      }}
    >
      {/* Card */}
      <div
        className="w-full max-w-2xl bg-white rounded-2xl overflow-hidden"
        style={{
          boxShadow: "0 8px 40px rgba(180, 80, 40, 0.12), 0 2px 12px rgba(0,0,0,0.06)",
        }}
      >
        {/* Top accent bar */}
        <div
          className="h-1.5 w-full"
          style={{ background: "linear-gradient(90deg, #E8603C 0%, #F0A090 50%, #E8603C 100%)" }}
        />

        <div className="px-8 pt-8 pb-10 sm:px-10 sm:pt-10">
          {submitted ? (
            <SuccessState name={form.name} smsSent={smsSent} />
          ) : (
            <>
              {/* Header */}
              <div className="text-center mb-8 animate-fade-slide-up delay-0">
                <p
                  className="text-xs font-semibold tracking-widest uppercase mb-3"
                  style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif", letterSpacing: "0.15em" }}
                >
                  Request a Quote
                </p>
                <h1
                  className="text-3xl sm:text-4xl font-bold leading-tight mb-3"
                  style={{ fontFamily: "'Playfair Display', serif", color: "#1E1E1E" }}
                >
                  Maid Service Quote
                  <br />
                  <span style={{ color: "#E8603C" }}>Washington DC</span>
                </h1>
                <p
                  className="text-sm sm:text-base leading-relaxed max-w-md mx-auto"
                  style={{ color: "#7A5A4A", fontFamily: "'DM Sans', sans-serif" }}
                >
                  Serving the Entire DC Metro Area (DC/MD/VA). Fill out the form below for an instant custom quote — we'll text you right away.
                </p>
              </div>

              {/* Divider */}
              <div
                className="animate-fade-slide-up delay-1 h-px w-16 mx-auto mb-8"
                style={{ background: "linear-gradient(90deg, transparent, #E8603C, transparent)" }}
              />

              {/* Form */}
              <form onSubmit={handleSubmit} noValidate>
                {/* Row 1: Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="animate-fade-slide-up delay-2">
                    <input
                      type="text"
                      placeholder="Name"
                      value={form.name}
                      onChange={(e) => handleChange("name", e.target.value)}
                      className="quote-input"
                      style={errors.name ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" } : {}}
                    />
                    {errors.name && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.name}
                      </p>
                    )}
                  </div>
                  <div className="animate-fade-slide-up delay-2">
                    <input
                      type="email"
                      placeholder="Email"
                      value={form.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                      className="quote-input"
                      style={errors.email ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" } : {}}
                    />
                    {errors.email && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.email}
                      </p>
                    )}
                  </div>
                </div>

                {/* Row 2: Phone + Service Type */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div className="animate-fade-slide-up delay-3">
                    <input
                      type="tel"
                      placeholder="Phone (e.g. +12025551234)"
                      value={form.phone}
                      onChange={(e) => handleChange("phone", e.target.value)}
                      className="quote-input"
                      style={errors.phone ? { borderColor: "#E8603C", boxShadow: "0 0 0 3px rgba(232,96,60,0.15)" } : {}}
                    />
                    {errors.phone && (
                      <p className="mt-1 text-xs" style={{ color: "#E8603C", fontFamily: "'DM Sans', sans-serif" }}>
                        {errors.phone}
                      </p>
                    )}
                  </div>
                  <div className="animate-fade-slide-up delay-3 quote-select-wrapper">
                    <select
                      value={form.serviceType}
                      onChange={(e) => handleChange("serviceType", e.target.value)}
                      className="quote-input"
                      style={{ paddingRight: "40px" }}
                    >
                      {SERVICE_TYPES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Row 3: Bedrooms + Bathrooms */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <div className="animate-fade-slide-up delay-4 quote-select-wrapper">
                    <select
                      value={form.bedrooms}
                      onChange={(e) => handleChange("bedrooms", e.target.value)}
                      className="quote-input"
                      style={{ paddingRight: "40px" }}
                    >
                      {BEDROOM_OPTIONS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div className="animate-fade-slide-up delay-4 quote-select-wrapper">
                    <select
                      value={form.bathrooms}
                      onChange={(e) => handleChange("bathrooms", e.target.value)}
                      className="quote-input"
                      style={{ paddingRight: "40px" }}
                    >
                      {BATHROOM_OPTIONS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* CTA Button */}
                <div className="animate-fade-slide-up delay-5 mb-6">
                  <button
                    type="submit"
                    className="quote-cta"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                          <path d="M12 2a10 10 0 0 1 10 10" />
                        </svg>
                        Sending your request...
                      </span>
                    ) : (
                      "Get My Instant Quote"
                    )}
                  </button>
                </div>

                {/* Stars */}
                <div className="animate-fade-slide-up delay-6 mb-4">
                  <StarRating />
                </div>

                {/* Legal */}
                <div className="animate-fade-slide-up delay-7 text-center">
                  <p
                    className="text-xs leading-relaxed"
                    style={{ color: "#9A7060", fontFamily: "'DM Sans', sans-serif" }}
                  >
                    By clicking "Get My Instant Quote" I agree to the{" "}
                    <a
                      href="#"
                      style={{ color: "#E8603C", textDecoration: "underline" }}
                      onClick={(e) => e.preventDefault()}
                    >
                      Terms of Use
                    </a>
                    . I understand information collected will be used as described in our{" "}
                    <a
                      href="#"
                      style={{ color: "#E8603C", textDecoration: "underline" }}
                      onClick={(e) => e.preventDefault()}
                    >
                      Privacy Policy
                    </a>
                    .
                  </p>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
