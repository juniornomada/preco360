import { describe, expect, it } from "vitest";
import { isUnchangedKawakamiCampaign } from "../../supabase/functions/collect-marilia-flyers/kawakamiCampaign";

const previous = {
  status: "processed",
  file_hash: "sha-of-two-pages",
  valid_from: "2026-11-03",
  valid_to: "2026-11-05",
};

const campaign = {
  fileHash: "sha-of-two-pages",
  validFrom: "2026-11-03",
  validTo: "2026-11-05",
};

describe("Kawakami incremental flyer capture", () => {
  it("skips only a fully identical already-processed campaign", () => {
    expect(isUnchangedKawakamiCampaign(previous, campaign)).toBe(true);
    expect(isUnchangedKawakamiCampaign({ ...previous, status: "unchanged" }, campaign)).toBe(true);
  });

  it("reimports when new pages appear under the same advertised dates", () => {
    const fourPageCapture = { ...campaign, fileHash: "sha-of-four-pages" };
    expect(isUnchangedKawakamiCampaign(previous, fourPageCapture)).toBe(false);
  });

  it("reimports corrected content even if page count stays the same", () => {
    const revisedPage = { ...campaign, fileHash: "sha-of-updated-pixels" };
    expect(isUnchangedKawakamiCampaign(previous, revisedPage)).toBe(false);
  });

  it("does not skip failed or incomplete jobs", () => {
    for (const status of ["downloaded", "queued", "processing", "error", "failed"]) {
      expect(isUnchangedKawakamiCampaign({ ...previous, status }, campaign)).toBe(false);
    }
    expect(isUnchangedKawakamiCampaign(null, campaign)).toBe(false);
  });

  it("does not reuse a different validity period", () => {
    expect(isUnchangedKawakamiCampaign(previous, { ...campaign, validTo: "2026-11-06" })).toBe(false);
    expect(isUnchangedKawakamiCampaign(previous, { ...campaign, validFrom: "2026-11-04" })).toBe(false);
  });

  it("requires real non-empty hashes to identify unchanged images", () => {
    expect(isUnchangedKawakamiCampaign({ ...previous, file_hash: "" }, campaign)).toBe(false);
    expect(isUnchangedKawakamiCampaign(previous, { ...campaign, fileHash: "" })).toBe(false);
  });
});
