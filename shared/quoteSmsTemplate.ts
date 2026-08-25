export function buildDefaultQuoteSms({
  firstName,
  welcomeUrl,
  hasDiscount,
}: {
  firstName: string;
  welcomeUrl: string;
  hasDiscount: boolean;
}): string {
  const discountParagraph = hasDiscount
    ? "\n\nWe've also added a nice discount for you as well 🎁"
    : "";

  return `Hi ${firstName}! Your custom quote is ready 🖤 Tap below to check out your pricing and grab your clean.${discountParagraph}

${welcomeUrl}

Booking's easy on our end, just need your phone, email, and address and we'll take it from there. Questions? Just reply here, happy to help.`;
}
