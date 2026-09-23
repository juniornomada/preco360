function normalizeCandidateText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const PROCESSING_FORMS: RegExp[] = [
  /\bdesfiad[ao]s?\b/,
  /\btriturad[ao]s?\b/,
  /\bhamburguer(?:es)?\b/,
  /\balmondega(?:s)?\b/,
  /\bcozid[ao]s?\b/,
  /\bassad[ao]s?\b/,
];

export function processingCompatible(expected: unknown, candidate: unknown) {
  const expectedText = normalizeCandidateText(expected);
  const candidateText = normalizeCandidateText(candidate);

  if (!candidateText) return true;

  for (const form of PROCESSING_FORMS) {
    if (form.test(candidateText) && !form.test(expectedText)) {
      return false;
    }
  }

  return true;
}
