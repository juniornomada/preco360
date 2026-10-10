import { describe, expect, it } from "vitest";
import {
  accessKeyDigitsFromTranscript,
  sanitizeAccessKeyDigits,
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
