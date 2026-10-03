import { describe, expect, it } from "vitest";
import { normalizeVoiceSearchBetaTranscript } from "@/hooks/useVoiceSearchBeta";

describe("normalizeVoiceSearchBetaTranscript", () => {
  it("preserves ordinary supermarket terms", () => {
    expect(normalizeVoiceSearchBetaTranscript("Leite.")).toBe("Leite");
    expect(normalizeVoiceSearchBetaTranscript("Filé mignon.")).toBe("Filé mignon");
  });

  it("corrects observed short-word ASR errors", () => {
    expect(normalizeVoiceSearchBetaTranscript("Sá.")).toBe("sal");
    expect(normalizeVoiceSearchBetaTranscript("Só.")).toBe("sal");
    expect(normalizeVoiceSearchBetaTranscript("A horse.")).toBe("arroz");
  });

  it("corrects observed Poncan segmentation", () => {
    expect(normalizeVoiceSearchBetaTranscript("Pão Cã.")).toBe("poncan");
  });

  it("normalizes observed butcher-cut confusions", () => {
    expect(normalizeVoiceSearchBetaTranscript("Colchão duro.")).toBe("coxão duro");
    expect(normalizeVoiceSearchBetaTranscript("Colchão mole.")).toBe("coxão mole");
  });

  it("normalizes specialty butcher names from observed ASR output", () => {
    expect(normalizeVoiceSearchBetaTranscript("Entrecô.")).toBe("Entrecot");
    expect(normalizeVoiceSearchBetaTranscript("Novax.")).toBe("Noix");
    expect(normalizeVoiceSearchBetaTranscript("Noax.")).toBe("Noix");
  });
});
