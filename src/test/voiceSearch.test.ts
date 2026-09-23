import { describe, expect, it } from "vitest";
import { normalizeVoiceSearchTranscript } from "@/hooks/useVoiceSearch";

describe("normalizeVoiceSearchTranscript", () => {
  it("normalizes spaces and removes trailing punctuation", () => {
    expect(normalizeVoiceSearchTranscript("  filé   de merluza Seara.  ")).toBe(
      "filé de merluza Seara",
    );
  });

  it("keeps product details that matter to search", () => {
    expect(normalizeVoiceSearchTranscript("Nescau 400g")).toBe("Nescau 400g");
  });

  it("keeps very short product names such as sal", () => {
    expect(normalizeVoiceSearchTranscript(" sal. ")).toBe("sal");
  });

  it("corrects the common pt-BR short-word transcription sau to sal", () => {
    expect(normalizeVoiceSearchTranscript("sau")).toBe("sal");
    expect(normalizeVoiceSearchTranscript("SAU.")).toBe("sal");
  });

  it("normalizes Ponkan spellings and the observed Chrome misrecognition", () => {
    const variants = [
      "poncã",
      "ponca",
      "poncan",
      "poncam",
      "ponkan",
      "ponkam",
      "ponka",
      "pocã",
      "poca",
      "pocan",
      "pocam",
      "pokan",
      "pokam",
      "moricote",
    ];

    for (const variant of variants) {
      expect(normalizeVoiceSearchTranscript(variant)).toBe("poncã");
    }
  });
});
