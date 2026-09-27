/** Price conditions that are not available without a store-branded payment card. */
export function isCardOnlyPriceCondition(offerNotes?: string[] | null) {
  return (offerNotes ?? []).some((note) =>
    /cart[aã]o.{0,50}(?:muffato|credifatto)|(?:muffato|credifatto).{0,50}cart[aã]o|pagando.{0,35}cart[aã]o|cart[aã]o.{0,35}pagando/i.test(String(note ?? "")),
  );
}
