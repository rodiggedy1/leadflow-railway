import { BOOKING_WIDGET_PRICED_EXTRAS } from "./bookingWidgetConfig";

export type CustomerPortalExtrasRequestSelection = {
  extraId: string;
  quantity?: number;
};

export type CustomerPortalResolvedExtra = {
  id: string;
  label: string;
  quantity: number;
  quantityUnit?: "window" | "load" | "room";
  unitPriceCents: number;
  lineTotalCents: number;
};

export function resolveCustomerPortalExtrasRequest(selections: readonly CustomerPortalExtrasRequestSelection[]) {
  const seen = new Set<string>();
  const extras = selections.map((selection) => {
    if (seen.has(selection.extraId)) throw new Error("Each extra can only be requested once.");
    seen.add(selection.extraId);

    const catalogItem = BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.id === selection.extraId);
    if (!catalogItem) throw new Error("Choose supported Book Now extras only.");

    const quantity = selection.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error("Extra quantities must be whole numbers between 1 and 100.");
    if (!catalogItem.quantityUnit && quantity !== 1) throw new Error(`${catalogItem.label} does not support a quantity.`);

    const unitPriceCents = catalogItem.unitPrice * 100;
    return {
      id: catalogItem.id,
      label: catalogItem.label,
      quantity,
      ...(catalogItem.quantityUnit ? { quantityUnit: catalogItem.quantityUnit } : {}),
      unitPriceCents,
      lineTotalCents: unitPriceCents * quantity,
    } satisfies CustomerPortalResolvedExtra;
  });

  return {
    extras,
    totalCents: extras.reduce((total, extra) => total + extra.lineTotalCents, 0),
  };
}

export function formatCustomerPortalExtrasEstimate(totalCents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(totalCents / 100);
}
