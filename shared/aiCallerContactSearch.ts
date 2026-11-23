export type AiCallerContactSearchResult = {
  id: string;
  source: "customer" | "lead" | "cleaner";
  name: string;
  phone: string | null;
  context: string;
};

export type CallerContactSearchFields = {
  name: string | null | undefined;
  phone: string | null | undefined;
  type?: string | null;
  location?: string | null;
};

/** The same literal, case-insensitive query for saved and local contacts. */
export function normalizeContactSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Search is a convenience, not a phone-validation or booking-eligibility gate. */
export function matchesCallerContactSearch(
  contact: CallerContactSearchFields,
  query: string,
): boolean {
  const normalized = normalizeContactSearchQuery(query);
  if (!normalized) return true;

  const tokens = normalized.split(" ");
  if ([contact.name, contact.type, contact.location].some(value => {
    const text = normalizeContactSearchQuery(value ?? "");
    let position = 0;
    return tokens.every(token => {
      const found = text.indexOf(token, position);
      if (found < 0) return false;
      position = found + token.length;
      return true;
    });
  })) return true;

  // Only phone-shaped queries use digit matching; "Team 2" is a name search.
  if (!/^[+\d\s()./\[\]–—-]+$/.test(normalized)) return false;
  const digits = normalized.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length > 0 && (contact.phone ?? "").replace(/\D/g, "").includes(digits);
}
