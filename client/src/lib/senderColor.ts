/**
 * Deterministic per-sender color palette.
 * Hash the sender's display name to one of 8 vivid colors.
 * Returns both Tailwind class strings and raw hex values for inline CSS.
 */

const PALETTE = [
  { tailwind: "bg-violet-100 text-violet-700", hex: "#7c3aed", bg: "#ede9fe" },
  { tailwind: "bg-sky-100 text-sky-700",       hex: "#0284c7", bg: "#e0f2fe" },
  { tailwind: "bg-emerald-100 text-emerald-700", hex: "#059669", bg: "#d1fae5" },
  { tailwind: "bg-amber-100 text-amber-700",   hex: "#d97706", bg: "#fef3c7" },
  { tailwind: "bg-rose-100 text-rose-700",     hex: "#e11d48", bg: "#ffe4e6" },
  { tailwind: "bg-teal-100 text-teal-700",     hex: "#0d9488", bg: "#ccfbf1" },
  { tailwind: "bg-indigo-100 text-indigo-700", hex: "#4338ca", bg: "#e0e7ff" },
  { tailwind: "bg-orange-100 text-orange-700", hex: "#ea580c", bg: "#ffedd5" },
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % PALETTE.length;
}

/** Returns Tailwind bg+text class string for avatar circles */
export function senderColorClass(name: string): string {
  return PALETTE[hashName(name)].tailwind;
}

/** Returns the vivid hex color for the sender (for accent bars, name labels, etc.) */
export function senderHex(name: string): string {
  return PALETTE[hashName(name)].hex;
}

/** Returns a light background hex for quoted block backgrounds */
export function senderBg(name: string): string {
  return PALETTE[hashName(name)].bg;
}
