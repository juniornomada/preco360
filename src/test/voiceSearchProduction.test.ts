import { describe, expect, it } from "vitest";
import { normalizeVoiceSearchProductionTranscript } from "@/hooks/useVoiceSearchProduction";

describe("normalizeVoiceSearchProductionTranscript", () => {
  it("normalizes the Kinino brand when pt-BR ASR returns quinino", () => {
    expect(normalizeVoiceSearchProductionTranscript("quinino")).toBe("Kinino");
    expect(normalizeVoiceSearchProductionTranscript("gelatina quinino.")).toBe(
      "gelatina Kinino",
    );
  });

  it("keeps ordinary product speech unchanged", () => {
    expect(normalizeVoiceSearchProductionTranscript("café Melitta")).toBe(
      "café Melitta",
    );
  });
});
