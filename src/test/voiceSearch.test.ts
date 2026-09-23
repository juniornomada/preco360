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
});
