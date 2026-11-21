import { createHash } from "node:crypto";
import type {
  PublicReview,
  ReviewGenerationResult,
  SafeBookingContext,
} from "../../shared/reviewResponses";

/** Tuple encoding prevents delimiter collisions; identity never depends on review text. */
export function reviewIdentity(review: Pick<PublicReview, "platform" | "accountId" | "businessId" | "reviewId">): string {
  return createHash("sha256")
    .update(JSON.stringify([review.platform, review.accountId, review.businessId, review.reviewId]))
    .digest("hex");
}

const normalized = (value: string): string => value.normalize("NFKC").toLowerCase().replace(new RegExp("\\s+", "gu"), " ").trim();
const folded = (value: string): string => normalized(value).normalize("NFD").replace(new RegExp("\\p{M}", "gu"), "");

// These are conservative lexical checks, not a semantic classifier. Human review
// remains required; negation does not suppress escalation of a serious mention.
const seriousMentions: ReadonlyArray<readonly [string, RegExp]> = [
  ["damage", new RegExp("\\b(damag\\w*|broke|broken|breakage|scratch\\w*|ruined|destroy\\w*|danos?|danad\\w*|danaron|danamos|rompieron|roto|rotura|dommag\\w*|casse\\w*|beschadig\\w*|schaden|beschadigt)\\b", "u")],
  ["theft", new RegExp("\\b(theft|stole|stolen|steal\\w*|missing\\s+(?:money|cash|jewel\\w*|belongings|valuables)|robo|robar\\w*|robado\\w*|vol(?:e|er|es|ee)?|voleur\\w*|diebstahl|gestohlen)\\b", "u")],
  ["safety", new RegExp("\\b(unsafe|safety|danger\\w*|hazard\\w*|injur\\w*|hurt|threat\\w*|assault\\w*|harass\\w*|toxic|peligro\\w*|insegur\\w*|amenaz\\w*|herid\\w*|agresi\\w*|securite|dangereu\\w*|bless\\w*|unsicher|gefahr\\w*)\\b", "u")],
  ["discrimination", new RegExp("\\b(discrimin\\w*|racis\\w*|sexist\\w*|homophob\\w*|transphob\\w*|bigot\\w*|rassismus|rassistisch)\\b", "u")],
  ["legal", new RegExp("\\b(lawsuit\\w*|sue|suing|sued|lawyer\\w*|attorney\\w*|legal\\s+(?:action|claim|notice|proceedings)|small\\s+claims|court|police|demanda\\w*|abogad\\w*|accion\\s+legal|tribunal|avocat\\w*|poursuites?\\s+(?:judiciaires|judiciaire)|justice|anwalt\\w*|klage)\\b", "u")],
  ["payment_dispute", new RegExp("\\b(charge\\s?backs?|payment\\s+disput\\w*|billing\\s+(?:disput\\w*|error)|double\\s+charg\\w*|charg\\w*\\s+(?:twice|without\\s+(?:my\\s+)?(?:permission|authorization))|unauthori[sz]ed\\s+charg\\w*|overcharg\\w*|refund\\w*|reembolso\\w*|cobro\\s+(?:doble|indebido)|disputa\\s+de\\s+pago|rembourse\\w*|factur\\w*\\s+(?:double|abusive)|ruckerstattung|doppelt\\s+berechnet)\\b", "u")],
];

export function severityReasonsFor(review: PublicReview): string[] {
  const reasons = review.rating <= 3 ? ["rating_1_to_3"] : [];
  const text = folded(review.text);
  for (const [reason, pattern] of seriousMentions) if (pattern.test(text)) reasons.push(reason);
  return reasons;
}

/** A callback is trusted only for a server-verified stable linkage, never a guessed match. */
export function safeBookingContext(review: PublicReview, value: SafeBookingContext | null): SafeBookingContext | null {
  if (!value || value.verified !== true ||
      !["thumbtack_negotiation_id", "explicit_booking_link"].includes(value.matchMethod) ||
      typeof value.bookingId !== "string" || !value.bookingId.trim() || value.bookingId.length > 256 ||
      !(value.serviceType === null || (typeof value.serviceType === "string" && value.serviceType.length <= 256)) ||
      !Array.isArray(value.privateTermsToExclude) || value.privateTermsToExclude.length > 100 ||
      !value.privateTermsToExclude.every(term => typeof term === "string" && term.length > 0 && term.length <= 2000)) return null;
  if (value.matchMethod === "thumbtack_negotiation_id" && (review.platform !== "thumbtack" || !review.negotiationId)) return null;
  return {
    verified: true,
    matchMethod: value.matchMethod,
    bookingId: value.bookingId,
    serviceType: value.serviceType,
    privateTermsToExclude: Array.from(new Set([value.bookingId, ...value.privateTermsToExclude])),
  };
}

export interface ResponseValidationInput {
  review: PublicReview;
  text: string;
  recentResponses?: string[];
  bookingContext?: SafeBookingContext | null;
  generation?: ReviewGenerationResult;
}

const compensation = new RegExp("\\b(refund\\w*|compensat\\w*|reimburs\\w*|discount\\w*|(?:free|complimentary)\\s+(?:clean\\w*|service\\w*|visit\\w*)|(?:offer|give|issue|provide)\\s+(?:you\\s+)?(?:a\\s+)?credit|waiv\\w*\\s+(?:the\\s+|your\\s+)?(?:fee|charge)|money\\s+back|reembols\\w*|compensacion|descuento\\w*|limpieza\\s+gratis|rembours\\w*|dedomm\\w*|nettoyage\\s+gratuit)\\b", "u");
const disputedAdmission = new RegExp("\\b(?:(?:we|our\\s+(?:team|cleaners?|staff))\\s+(?:(?:have|had|did|accidentally)\\s+)?(?:broke|damaged|stole|caused|destroyed|lost|injured|overcharged)|(?:we\\s+(?:are|were)|we're)\\s+(?:at\\s+fault|responsible|liable)|our\\s+fault|we\\s+admit|you(?:'re|\\s+are)\\s+right\\s+(?:that|about)|nosotros\\s+(?:danamos|rompimos|robamos)|nuestra\\s+culpa|nous\\s+avons\\s+(?:casse|vole|endommage))\\b", "u");
const blame = new RegExp("\\b(your\\s+fault|you\\s+(?:lied|caused|should\\s+have|failed\\s+to)|(?:false|fake|dishonest)\\s+(?:review|claim|complaint)|(?:customer|you)\\s+(?:is|are)\\s+lying|not\\s+our\\s+(?:fault|responsibility)|culpa\\s+(?:suya|tuya)|usted\\s+miente|vous\\s+mentez)\\b", "u");
const unsupportedPromises = new RegExp("\\b(we(?:'ll|\\s+will)\\s+(?:call|contact|send|return|fix|replace|investigate|resolve|refund)|(?:we|our\\s+team)\\s+(?:have|has|already)\\s+(?:contacted|called|reviewed|investigated|resolved)|guarantee\\w*|we\\s+promise)\\b", "u");
const specificWords = new RegExp("\\b(kitchen\\w*|bathroom\\w*|bedroom\\w*|floor\\w*|carpet\\w*|window\\w*|oven\\w*|fridge\\w*|refrigerator\\w*|laundry|apartment|move[- ]?(?:in|out)|deep\\s+clean\\w*|pet\\w*|dog\\w*|cat\\w*|children|kids|punctual\\w*|on\\s+time|spotless|thorough\\w*|professional\\w*|friendly|recurring|weekly|monthly|first\\s+(?:visit|clean\\w*)|regular\\s+(?:customer|client)|years?|cocina\\w*|bano\\w*|alfombra\\w*|cuisine|salle\\s+de\\s+bain)\\b", "gu");
const specificAssertion = new RegExp("\\b(?:(?:we|our\\s+(?:team|cleaners?|staff))\\s+(?:(?:have|had)\\s+)?(?:cleaned|arrived|visited|completed|left|provided|delivered|serviced|helped)|your\\s+(?:cleaning|service|appointment|booking|visit)|(?:last|next)\\s+(?:visit|cleaning)|as\\s+(?:always|usual))\\b", "u");

const privateContact = new RegExp("(?:[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}|(?:\\+?\\d[\\d ().-]{5,}\\d))", "iu");
const privateAddress = new RegExp("\\b\\d{1,6}\\s+(?:[\\p{L}\\d.'-]+\\s+){0,5}(?:street|st\\.?|avenue|ave\\.?|road|rd\\.?|lane|ln\\.?|drive|dr\\.?|boulevard|blvd\\.?|court|ct\\.?|way|place|pl\\.?|calle|rue)\\b", "iu");
const privateDate = new RegExp("\\b(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\s+\\d{1,2}|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\\d{1,2}:\\d{2}(?:\\s*[ap]m)?)\\b", "iu");
const bookingMention = new RegExp("\\b(?:booking|reservation|appointment|negotiation)\\s*(?:id|number|#|reference)\\b", "iu");

function sentenceEdges(text: string): [string, string] {
  const sentences = text.trim().split(new RegExp("[.!?]+(?:\\s+|$)|\\n+", "u")).map(normalized).filter(Boolean);
  const clean = (part: string) => part.replace(new RegExp("[^\\p{L}\\p{N}\\s]", "gu"), "").replace(new RegExp("\\s+", "gu"), " ").trim();
  return [clean(sentences[0] ?? text), clean(sentences.at(-1) ?? text)];
}

/** Issues are fixed codes, never private terms or provider diagnostics. */
export function validateReviewResponse(input: ResponseValidationInput): string[] {
  const { review, text, generation } = input;
  const issues = new Set<string>();
  const response = folded(text);
  const source = folded(review.text);
  if (!text.trim() || text.length > 20000) issues.add("invalid_response_text");
  if (review.existingResponse?.trim()) issues.add("existing_response");
  if (privateContact.test(text)) issues.add("private_contact_or_identifier");
  if (privateAddress.test(text)) issues.add("private_address");
  if (privateDate.test(text)) issues.add("private_date_or_time");
  if (bookingMention.test(text)) issues.add("private_booking_identifier");
  const privateTerms = [review.negotiationId, input.bookingContext?.bookingId, ...(input.bookingContext?.privateTermsToExclude ?? [])];
  for (const term of privateTerms) {
    if (term && normalized(text).includes(normalized(term))) issues.add("private_context_term");
  }
  if (compensation.test(response)) issues.add("compensation_not_allowed");
  if (disputedAdmission.test(response)) issues.add("disputed_facts_admission");
  if (blame.test(response)) issues.add("customer_blame");
  if (unsupportedPromises.test(response)) issues.add("unsupported_promise_or_history");
  if (response.replace(new RegExp("[^\\p{L}\\p{N}\\s]", "gu"), "").includes("we truly appreciate your wonderful feedback")) issues.add("generic_prompt_phrase");
  if ((text.match(new RegExp("!", "gu")) ?? []).length > 2) issues.add("exclamation_overuse");
  if ((text.match(new RegExp("\\p{Extended_Pictographic}", "gu")) ?? []).length > 1) issues.add("emoji_overuse");
  const firstName = folded(review.reviewerName).split(new RegExp("\\s+", "u"))[0];
  if (firstName && firstName.length > 1) {
    const words = response.match(new RegExp("[\\p{L}'-]+", "gu")) ?? [];
    if (words.filter(word => word === firstName).length > 1) issues.add("reviewer_name_overuse");
  }

  const greeting = text.match(new RegExp("^(?:Hi|Hello|Dear|Hey|Thanks|Thank you)[,\\s]+([\\p{Lu}][\\p{L}'-]*)\\b", "u"));
  if (greeting && !folded(review.reviewerName).split(new RegExp("\\s+", "u")).includes(folded(greeting[1]))) issues.add("unverified_reviewer_name");
  const specifics = Array.from(response.matchAll(specificWords)).map(match => match[0]);
  if (specifics.some(term => !source.includes(term))) issues.add("unsupported_specific_details");
  if (!source && (specifics.length || specificAssertion.test(response))) issues.add("rating_only_fabricated_details");
  if (source && specificAssertion.test(response) && specifics.length === 0) issues.add("unverified_service_or_history_claim");

  if (generation) {
    if (generation.safetyFlags.length) issues.add("provider_safety_flags");
    if (generation.unsupportedClaims.length) issues.add("provider_unsupported_claims");
    if (source && generation.groundingQuotes.length === 0) issues.add("missing_grounding_quotes");
    if (generation.groundingQuotes.some(quote => !quote.trim() || !review.text.includes(quote))) issues.add("invalid_grounding_quote");
    if (specifics.some(term => !generation.groundingQuotes.some(quote => folded(quote).includes(term)))) issues.add("unsupported_specific_grounding");
  }
  // Compare the immediately preceding response, not arbitrary historical boilerplate.
  const previous = input.recentResponses?.find(value => value.trim());
  if (previous) {
    const [opening, closing] = sentenceEdges(text);
    const [previousOpening, previousClosing] = sentenceEdges(previous);
    if (opening && opening === previousOpening) issues.add("consecutive_opening_reused");
    if (closing && closing === previousClosing) issues.add("consecutive_closing_reused");
  }
  return Array.from(issues);
}
