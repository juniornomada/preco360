import { describe, expect, it } from "vitest";
import { normalizeVoiceSearchProductionTranscript } from "@/hooks/useVoiceSearchProduction";

describe("normalizeVoiceSearchProductionTranscript", () => {
  it("normalizes common Kinino ASR variants", () => {
    expect(normalizeVoiceSearchProductionTranscript("quinino")).toBe("Kinino");
    expect(normalizeVoiceSearchProductionTranscript("gelatina quinino.")).toBe(
      "gelatina Kinino",
    );
    expect(normalizeVoiceSearchProductionTranscript("gelatina que Nino.")).toBe(
      "gelatina Kinino",
    );
    expect(normalizeVoiceSearchProductionTranscript("gelatina qui nino")).toBe(
      "gelatina Kinino",
    );
  });

  it("keeps ordinary product speech unchanged", () => {
    expect(normalizeVoiceSearchProductionTranscript("café Melitta")).toBe(
      "café Melitta",
    );
  });
});
