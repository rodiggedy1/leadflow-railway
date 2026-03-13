/**
 * ConversionFunnelCard
 * Shows a three-step funnel: Visitors → Leads → Booked
 * with conversion rates between each step.
 */

import { trpc } from "@/lib/trpc";
import { Users, FileText, CalendarCheck } from "lucide-react";

interface Props {
  dateFrom?: string;
  dateTo?: string;
}

function pct(num: number, denom: number): string {
  if (!denom) return "—";
  return ((num / denom) * 100).toFixed(1) + "%";
}

export default function ConversionFunnelCard({ dateFrom, dateTo }: Props) {
  const { data, isLoading } = trpc.leads.visitorStats.useQuery(
    { dateFrom, dateTo },
    { refetchInterval: 60_000 }
  );

  const visitors = data?.visitors ?? 0;
  const leads = data?.leads ?? 0;
  const booked = data?.booked ?? 0;

  const steps = [
    {
      label: "Visitors",
      value: visitors,
      icon: Users,
      color: "text-blue-500",
      bg: "bg-blue-50",
      border: "border-blue-200",
    },
    {
      label: "Leads",
      value: leads,
      icon: FileText,
      color: "text-amber-500",
      bg: "bg-amber-50",
      border: "border-amber-200",
      rate: pct(leads, visitors),
      rateLabel: "visitor → lead",
    },
    {
      label: "Booked",
      value: booked,
      icon: CalendarCheck,
      color: "text-emerald-500",
      bg: "bg-emerald-50",
      border: "border-emerald-200",
      rate: pct(booked, leads),
      rateLabel: "lead → booked",
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">
        Conversion Funnel
      </h3>

      {isLoading ? (
        <div className="flex gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-1 h-20 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="flex items-center gap-2 flex-1 min-w-0">
                {/* Step card */}
                <div
                  className={`flex-1 rounded-xl border ${step.border} ${step.bg} px-4 py-3 text-center`}
                >
                  <div className={`flex justify-center mb-1 ${step.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="text-2xl font-bold text-gray-800">
                    {step.value.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{step.label}</div>
                  {step.rate && (
                    <div className={`text-xs font-semibold mt-1 ${step.color}`}>
                      {step.rate}
                    </div>
                  )}
                  {step.rateLabel && (
                    <div className="text-[10px] text-gray-400">{step.rateLabel}</div>
                  )}
                </div>

                {/* Arrow between steps */}
                {idx < steps.length - 1 && (
                  <div className="text-gray-300 text-lg font-light shrink-0">→</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && visitors === 0 && (
        <p className="text-xs text-gray-400 mt-3 text-center">
          Visitor tracking starts counting from now. Data will appear as the form receives traffic.
        </p>
      )}
    </div>
  );
}
