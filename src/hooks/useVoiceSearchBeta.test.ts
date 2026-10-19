import { describe, expect, it } from "vitest";
import { normalizeVoiceSearchBetaTranscript } from "./useVoiceSearchBeta";
import { productSearchTokens } from "@/lib/productSearch";

describe("beta voice supermarket transcription", () => {
  it.each([
    ["Porta dela", "mortadela"],
    ["Mortandela", "mortadela"],
    ["Capuchinho", "cappuccino"],
    ["Green Tease", "cream cheese"],
    ["Mírio verde bandeja", "milho verde bandeja"],
    ["Tarrou 5 quilos", "arroz 5 quilos"],
    ["Iorgute", "iogurte"],
    ["Ovo Maltini", "Ovomaltine"],
    ["Ovo malchini", "Ovomaltine"],
    ["ovo maltine", "Ovomaltine"],
    ["ovo maltino", "Ovomaltine"],
    ["ovomaltine", "Ovomaltine"],
    ["Mortandela fatiada 200g", "mortadela fatiada 200g"],
    ["Bortandela", "mortadela"],
    ["Martandela", "mortadela"],
    ["Morta dela", "mortadela"],
    ["Mortando", "mortadela"],
    ["Ovo Mocinho", "Ovomaltine"],
    ["Ovo-Molchini", "Ovomaltine"],
    ["Ovo malchine", "Ovomaltine"],
    ["Ovo Maltinho", "Ovomaltine"],
  ])("corrects observed ASR output %s", (heard, expected) => {
    expect(normalizeVoiceSearchBetaTranscript(heard)).toBe(expected);
  });

  it("does not turn a real mattress query into a meat cut", () => {
    expect(normalizeVoiceSearchBetaTranscript("colchão duro")).toBe("colchão duro");
  });

  it.each(["moçarela", "mussarela", "muçarela", "mozzarela", "mozarela", "muzzarela", "muzarela"])(
    "matches cheese spelling %s", (value) => {
      expect(productSearchTokens(value)).toEqual(["mussarela"]);
    },
  );
});
