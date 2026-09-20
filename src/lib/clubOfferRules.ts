import { normalizeSearchText } from "@/lib/flyerAnalysis";

const MAX_ATACADISTA = "max atacadista";
export const APP_ACTIVATION_NOTE = "Ativar desconto no app";

function normalizedRetailer(retailer?: string | null) {
  return normalizeSearchText(retailer ?? "");
}

export function requiresAppActivation(
  retailer?: string | null,
  offerNotes?: string[] | null,
) {
  if (normalizedRetailer(retailer) === MAX_ATACADISTA) return true;

  return (offerNotes ?? []).some((note) =>
    /ativ(?:e|ar|acao|ação)?.*app|app.*ativ/i.test(note),
  );
}

export function ensureClubActivationNote(
  retailer: string | null | undefined,
  clubPrice: number | string | null | undefined,
  offerNotes?: string[] | null,
) {
  const notes = [...(offerNotes ?? [])];
  const value = Number(clubPrice);

  if (
    normalizedRetailer(retailer) !== MAX_ATACADISTA ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return notes;
  }

  const alreadyHasAppNote = notes.some((note) =>
    /ativ(?:e|ar|acao|ação)?.*app|app.*ativ/i.test(note),
  );

  if (!alreadyHasAppNote) notes.push(APP_ACTIVATION_NOTE);
  return notes;
}
