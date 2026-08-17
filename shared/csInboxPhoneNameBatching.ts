export const CS_INBOX_NAME_LOOKUP_BATCH_SIZE = 100;

function normalizedPhone10(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d]/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

export function batchCsInboxPhonesForNameLookup(
  phones: Array<string | null | undefined>,
  batchSize = CS_INBOX_NAME_LOOKUP_BATCH_SIZE,
): string[][] {
  const uniquePhones = [...new Set(phones
    .map(normalizedPhone10)
    .filter((phone): phone is string => phone !== null))];

  const batches: string[][] = [];
  for (let index = 0; index < uniquePhones.length; index += batchSize) {
    batches.push(uniquePhones.slice(index, index + batchSize));
  }
  return batches;
}

export function mergeCsInboxNameMaps(
  maps: Array<Record<string, string> | undefined>,
): Record<string, string> {
  return Object.assign({}, ...maps.filter((map): map is Record<string, string> => Boolean(map)));
}
