/**
 * Home page — renders the embeddable QuoteForm + floating SMS chat widget
 * Design: Warm Coral Hospitality
 */
import QuoteForm from "@/components/QuoteForm";
import SmsWidget from "@/components/SmsWidget";

export default function Home() {
  return (
    <>
      <QuoteForm />
      <SmsWidget />
    </>
  );
}
