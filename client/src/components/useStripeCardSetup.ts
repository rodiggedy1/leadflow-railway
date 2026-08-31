import { useState } from "react";
import { CardElement, useElements, useStripe } from "@stripe/react-stripe-js";

export const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontSize: "15px",
      color: "#1e2430",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Arial, sans-serif",
      "::placeholder": { color: "#a0aab8" },
      iconColor: "#ff6b1a",
    },
    invalid: { color: "#e53e3e", iconColor: "#e53e3e" },
  },
  hidePostalCode: false,
} as const;

type UseStripeCardSetupInput = {
  clientSecret: string;
  prefillName: string;
  onSetupSucceeded: (paymentMethodId: string, billingName: string) => Promise<void>;
};

/** The existing /pay card collection logic, shared without exposing raw card data. */
export function useStripeCardSetup({ clientSecret, prefillName, onSetupSucceeded }: UseStripeCardSetupInput) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState(prefillName);
  const [cardError, setCardError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    setCardError(null);
    try {
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error("Card element not found");
      const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement, billing_details: { name } },
      });
      if (error) {
        setCardError(error.message ?? "Card declined. Please try a different card.");
        setLoading(false);
        return;
      }
      if (!setupIntent?.payment_method) {
        setCardError("Something went wrong. Please try again.");
        setLoading(false);
        return;
      }
      await onSetupSucceeded(setupIntent.payment_method as string, name);
    } catch (error: unknown) {
      setCardError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return { stripeReady: Boolean(stripe), name, setName, cardError, loading, handleSubmit };
}
