export type CustomerBookingField = "name" | "phone" | "email" | "address";

const fieldNames: Record<string, CustomerBookingField> = {
  customerName: "name",
  customerPhone: "phone",
  customerEmail: "email",
  address: "address",
};
const fieldMessages: Record<CustomerBookingField, string> = {
  name: "Enter your first and last name.",
  phone: "Enter a valid phone number.",
  email: "Enter a valid email address.",
  address: "Enter the complete service address.",
};

export function customerBookingError(cause: unknown, fallback: string): {
  message: string;
  field?: CustomerBookingField;
} {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (!message) return { message: fallback };
  try {
    const issues: unknown = JSON.parse(message);
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        const field = fieldNames[issue?.path?.[0]];
        if (field) return { message: fieldMessages[field], field };
      }
    }
    return { message: fallback };
  } catch {
    // Ordinary Stripe and application messages are already customer-readable.
  }
  if (message.length > 300 || /failed query|params:|\b(?:insert into|select .* from|update .* set|delete from)\b|^\s*[\[{]/i.test(message)) {
    return { message: fallback };
  }
  const field: CustomerBookingField | undefined = /valid.*(?:phone|number)/i.test(message)
    ? "phone"
    : /valid.*email/i.test(message)
      ? "email"
      : /(?:first and last name|valid.*name)/i.test(message)
        ? "name"
        : /(?:complete|valid).*address/i.test(message)
          ? "address"
          : undefined;
  return { message, ...(field ? { field } : {}) };
}
