import { describe, expect, it } from "vitest";
import {
  accessKeyDigitsFromTranscript,
  sanitizeAccessKeyDigits,
  removeInterimEcho,
  speechReplayOverlap,
} from "@/lib/accessKeyVoice";

describe("accessKeyDigitsFromTranscript", () => {
  it("converts individual pt-BR digit words", () => {
    expect(
      accessKeyDigitsFromTranscript(
        "três cinco dois seis um zero seis cinco oito nove sete nove",
      ),
    ).toBe("352610658979");
  });

  it("keeps literal digits in the transcript", () => {
    expect(accessKeyDigitsFromTranscript("3 5 2 6 1 0 6 5")).toBe("35261065");
    expect(accessKeyDigitsFromTranscript("35261065")).toBe("35261065");
  });

  it("handles common grouped ASR cardinals", () => {
    expect(
      accessKeyDigitsFromTranscript("trinta e cinco vinte e seis dez"),
    ).toBe("352610");
    expect(accessKeyDigitsFromTranscript("quarenta e quatro")).toBe("44");
  });

  it("accepts meia as spoken six", () => {
    expect(accessKeyDigitsFromTranscript("três cinco meia dois")).toBe("3562");
  });

  it("ignores unrelated words", () => {
    expect(
      accessKeyDigitsFromTranscript("chave três cinco agora dois seis"),
    ).toBe("3526");
  });
});

describe("sanitizeAccessKeyDigits", () => {
  it("keeps digits only and caps the key at 44 positions", () => {
    const value = "35.2610 abc " + "1234567890".repeat(5);
    const sanitized = sanitizeAccessKeyDigits(value);

    expect(sanitized).toMatch(/^\d{44}$/);
    expect(sanitized).toHaveLength(44);
  });
});

describe("speech-replay protection", () => {
  it("removes an echo when final and interim repeat the same phrase", () => {
    expect(removeInterimEcho("3526", "3526")).toBe("");
    expect(removeInterimEcho("3526", "352618")).toBe("18");
  });

  it("removes a suffix/prefix replay of 3+ digits after recognition restarts", () => {
    expect(speechReplayOverlap("13526", "352678")).toBe(4);
    expect(speechReplayOverlap("3526", "3526")).toBe(4);
  });

  it("does not remove repeated individual digits or short groups", () => {
    expect(speechReplayOverlap("00", "00")).toBe(0);
    expect(speechReplayOverlap("3", "3")).toBe(0);
    expect(removeInterimEcho("11", "11")).toBe("11");
  });

  it("does not globally deduplicate real consecutive repetitions", () => {
    expect(speechReplayOverlap("3526", "1111")).toBe(0);
    expect(accessKeyDigitsFromTranscript("zero zero tres tres tres")).toBe("00333");
    expect(accessKeyDigitsFromTranscript("3 5 2 6 3 5 2 6")).toBe("35263526");
  });
});
