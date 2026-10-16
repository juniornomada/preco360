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

  it("normalizes caqui variants from speech only", () => {
    expect(normalizeVoiceSearchBetaTranscript("Kaqui.")).toBe("caqui");
    expect(normalizeVoiceSearchBetaTranscript("Kaki.")).toBe("caqui");
    expect(normalizeVoiceSearchBetaTranscript("Cacique.")).toBe("caqui");
    expect(normalizeVoiceSearchBetaTranscript("Caqui.")).toBe("Caqui");
    expect(normalizeVoiceSearchBetaTranscript("Cacique Café")).toBe("Cacique Café");
  });

  it("repairs the three observed milho ASR errors without changing other words", () => {
    const misheard = ["Mídium.", "Mílio.", "Mido.", "Mínio."];
    for (const transcript of misheard) {
      expect(normalizeVoiceSearchBetaTranscript(transcript)).toBe("milho");
    }
    expect(normalizeVoiceSearchBetaTranscript("Mílio Verde")).toBe("milho verde");
    expect(normalizeVoiceSearchBetaTranscript("Milho.")).toBe("Milho");
    expect(normalizeVoiceSearchBetaTranscript("Milho para pipoca")).toBe("Milho para pipoca");
    expect(normalizeVoiceSearchBetaTranscript("Arroz médio")).toBe("Arroz médio");
  });

  it("repairs banana maçã and Murcott speech without rewriting other queries", () => {
    expect(normalizeVoiceSearchBetaTranscript("Banana Massa")).toBe("banana maçã");
    expect(normalizeVoiceSearchBetaTranscript("Banana Maçã")).toBe("Banana Maçã");
    expect(normalizeVoiceSearchBetaTranscript("Banana prata")).toBe("Banana prata");
    expect(normalizeVoiceSearchBetaTranscript("Moricote.")).toBe("murcote");
    expect(normalizeVoiceSearchBetaTranscript("Tangerina.")).toBe("Tangerina");
    expect(normalizeVoiceSearchBetaTranscript("PONCÃ")).toBe("poncan");
  });

  it("normalizes specialty butcher names from observed ASR output", () => {
    expect(normalizeVoiceSearchBetaTranscript("Entrecô.")).toBe("Entrecot");
    expect(normalizeVoiceSearchBetaTranscript("Novax.")).toBe("Noix");
    expect(normalizeVoiceSearchBetaTranscript("Noax.")).toBe("Noix");
  });
});
