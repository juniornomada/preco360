import { normalizeSearchText } from "@/lib/flyerAnalysis";

const MAX_ATACADISTA = "max atacadista";
export const APP_ACTIVATION_NOTE = "Ativar desconto no app";

function normalizedRetailer(retailer?: string | null) {
  return normalizeSearchText(retailer ?? "");
}

function normalizedOfferNotes(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    // Some older/imported rows may contain a JSON-encoded array instead of
    // an actual Postgres/JSON array. Normalize both shapes before reading it.
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item ?? "").trim())
            .filter(Boolean);
        }
      } catch {
        // Fall back to treating the original value as one note.
      }
    }

    return [trimmed];
  }

  return [];
}

export function requiresAppActivation(
  retailer?: string | null,
  offerNotes?: string[] | null,
) {
  if (normalizedRetailer(retailer) === MAX_ATACADISTA) return true;

  return normalizedOfferNotes(offerNotes).some((note) =>
    /ativ(?:e|ar|acao|ação)?.*app|app.*ativ/i.test(note),
  );
}

export function ensureClubActivationNote(
  retailer: string | null | undefined,
  clubPrice: number | string | null | undefined,
  offerNotes?: string[] | null,
) {
  const notes = normalizedOfferNotes(offerNotes);
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
