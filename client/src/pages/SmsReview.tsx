import CsInboxCRMReview from "./CsInboxCRMReview";
import "./sms-review.css";
import "./sms-leads-cohesion.css";
import "./sms-identity-portraits.css";

export default function SmsReview() {
  return <div className="sms-review" data-review-only="true"><CsInboxCRMReview /></div>;
}
