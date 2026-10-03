/** Price conditions that are unavailable without a store-branded payment method. */
export function isCardOnlyPriceCondition(offerNotes?: string[] | null) {
  return (offerNotes ?? []).some((note) =>
    /(taustepay|pagando.{0,40}cart[aã]o|cart[aã]o.{0,40}pagando|cart[aã]o\s+elo|credifatto|cart[aã]o.{0,30}muffato|muffato.{0,30}cart[aã]o)/i.test(
      String(note ?? ""),
    ),
  );
}
