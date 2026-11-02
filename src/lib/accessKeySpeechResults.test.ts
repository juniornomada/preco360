import { describe, expect, it } from "vitest";
import { accessKeyDigitsFromTranscript, sanitizeAccessKeyDigits } from "./accessKeyVoice";
import { assembleAccessKeySpeechChunks as assemble } from "./accessKeySpeechResults";
import { validateAccessKey } from "./nfceKey";

const originalKey = "35261153045266001350652170000962351002135504";
const missingZeroKey = "3526115304526600135065217000962351002135504";

const slot = (transcript: string, isFinal = true) => ({
  digits: accessKeyDigitsFromTranscript(transcript),
  isFinal,
});

describe("NFC-e speech result snapshot assembly", () => {
  it("keeps each of four zeros in separate native result slots", () => {
    const snapshot = Array.from({ length: 4 }, () => slot("zero"));
    expect(assemble(snapshot)).toEqual({ finalDigits: "0000", interimDigits: "" });
  });

  it("preserves adjacent repeated single digits and multi-digit groups", () => {
    expect(assemble([slot("zero"), slot("zero")]).finalDigits).toBe("00");
    expect(assemble([slot("35"), slot("35")]).finalDigits).toBe("3535");
    expect(assemble([slot("doze"), slot("doze")]).finalDigits).toBe("1212");
  });

  it("does not treat a distinct longer slot as a cumulative update", () => {
    expect(assemble([slot("35"), slot("356")]).finalDigits).toBe("35356");
  });

  it("does not accumulate identical onresult event snapshots", () => {
    const snapshot = [slot("sete"), slot("zero"), slot("zero", false)];
    expect(assemble(snapshot)).toEqual({ finalDigits: "70", interimDigits: "0" });
    expect(assemble(snapshot)).toEqual(assemble(snapshot));
  });

  it("replaces an interim hypothesis in its original slot", () => {
    expect(assemble([slot("doze", false)]).interimDigits).toBe("12");
    expect(assemble([slot("doze três", false)]).interimDigits).toBe("123");
    expect(assemble([slot("doze três", true)]).finalDigits).toBe("123");
  });

  it("handles finalization of one slot while the next remains interim", () => {
    expect(assemble([slot("sete zero", true), slot("zero", false)])).toEqual({
      finalDigits: "70", interimDigits: "0",
    });
    expect(assemble([slot("sete zero", true), slot("zero", true)])).toEqual({
      finalDigits: "700", interimDigits: "",
    });
  });

  it("preserves the full 44-digit NFC-e key including four consecutive zeros", () => {
    const slots = [
      slot(originalKey.slice(0, 25)),
      slot("zero"),
      slot("zero"),
      slot("zero"),
      slot("zero"),
      slot(originalKey.slice(29)),
    ];
    const { finalDigits } = assemble(slots);
    expect(finalDigits).toBe(originalKey);
    expect(finalDigits).toHaveLength(44);
    expect(validateAccessKey(finalDigits).valid).toBe(true);
  });

  it("does not invent the missing zero: a 43-digit key remains invalid", () => {
    expect(sanitizeAccessKeyDigits(missingZeroKey)).toHaveLength(43);
    expect(validateAccessKey(missingZeroKey).valid).toBe(false);
    expect(sanitizeAccessKeyDigits(originalKey + "0")).toBe(originalKey);
  });
});

describe("Android/Chrome cumulative final-result slots (real trace)", () => {
  const androidTrace = [
    "", "7", "", "70", "", "", "7 0",
    "7 0 0", "7 0 0", "7 0 0 0", "7 0 0 0",
    "7 0 0 0 9", "7 0 0 0 9", "7 0 0 0 9 6",
    "7 0 0 0 9 6", "7 0 0 0 9 6 2", "7 0 0 0 9 6 2",
  ];

  it("reconstructs the captured final hypothesis instead of concatenating prefixes", () => {
    const chunks = androidTrace.map((text) => slot(text));
    expect(assemble(chunks)).toEqual({
      finalDigits: "7000962",
      interimDigits: "",
    });
  });

  it("never reaches a fake 44 digits as the real trace grows", () => {
    for (let index = 0; index < androidTrace.length; index += 1) {
      const result = assemble(androidTrace.slice(0, index + 1).map((text) => slot(text)));
      expect(result.finalDigits.length).toBeLessThan(44);
    }
  });

  it("preserves four actual zeros if Android emits them cumulatively", () => {
    const chunks = ["7", "7 0", "7 0 0", "7 0 0 0", "7 0 0 0 0",
      "7 0 0 0 0 9", "7 0 0 0 0 9 6", "7 0 0 0 0 9 6 2"].map((text) => slot(text));
    expect(assemble(chunks).finalDigits).toBe("70000962");
  });

  it("preserves spoken consecutive zeros in cumulative prefix chains", () => {
    expect(assemble(["0", "00", "000", "0000"].map((text) => slot(text))).finalDigits)
      .toBe("0000");
    expect(assemble(["0", "0", "0", "0"].map((text) => slot(text))).finalDigits)
      .toBe("0000");
  });

  it("preserves ordinary unrelated consecutive and identical segments", () => {
    expect(assemble(["12", "12", "13"].map((text) => slot(text))).finalDigits)
      .toBe("121213");
    expect(assemble(["7", "70", "71"].map((text) => slot(text))).finalDigits)
      .toBe("77071");
  });

  it("handles multiple cumulative prefix runs when the hypothesis resets", () => {
    expect(assemble(["7", "70", "700", "9", "96", "962"].map((text) => slot(text))).finalDigits)
      .toBe("700962");
  });

  it("does not duplicate an already long full-key hypothesis", () => {
    expect(assemble([slot(originalKey.slice(0, 43)), slot(originalKey)]).finalDigits)
      .toBe(originalKey);
    expect(validateAccessKey(assemble([slot(originalKey.slice(0, 43)), slot(originalKey)]).finalDigits).valid)
      .toBe(true);
  });

  it("keeps the most recent growing interim hypothesis", () => {
    expect(assemble([slot("7"), slot("70"), slot("700", false)])).toEqual({
      finalDigits: "",
      interimDigits: "700",
    });
  });

  it("does not invent the fourth zero absent from the Android native transcript", () => {
    const captured = assemble(androidTrace.map((text) => slot(text))).finalDigits;
    expect(captured).toBe("7000962");
    expect(captured).not.toBe("70000962");
  });
});

describe("NFC-e spoken-number parsing", () => {
  it("keeps consecutive zeros in the same transcript", () => {
    expect(accessKeyDigitsFromTranscript("zero zero zero zero")).toBe("0000");
    expect(accessKeyDigitsFromTranscript("7 zero zero zero zero 962")).toBe("70000962");
  });

  it("recognizes individual digits and the spoken word meia", () => {
    expect(accessKeyDigitsFromTranscript("três cinco")).toBe("35");
    expect(accessKeyDigitsFromTranscript("um dois")).toBe("12");
    expect(accessKeyDigitsFromTranscript("cinco dois seis")).toBe("526");
    expect(accessKeyDigitsFromTranscript("meia")).toBe("6");
  });

  it("recognizes tens without losing adjacent digits", () => {
    expect(accessKeyDigitsFromTranscript("trinta e cinco")).toBe("35");
    expect(accessKeyDigitsFromTranscript("doze")).toBe("12");
    expect(accessKeyDigitsFromTranscript("cinquenta e dois seis")).toBe("526");
  });

  it("does not collapse zero when it follows a spoken ten", () => {
    expect(accessKeyDigitsFromTranscript("trinta zero zero")).toBe("3000");
    expect(accessKeyDigitsFromTranscript("vinte e cinco zero zero")).toBe("2500");
  });
});
