import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SINGLE_DAY_FLYER_VALIDITY_GUIDANCE } from "../../supabase/functions/process-flyer-job/singleDayValidityGuidance";

describe("one-day flyer validity: safety guidance", () => {
  it("requires explicit single-day language AND a legible calendar date", () => {
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain("APENAS UM DIA");
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain("inequivocamente legível");
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain("valid_from e valid_to com a MESMA data");
  });
  it("does not assume an end date just because a campaign is called Dia M", () => {
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain('"Dia M"');
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain("NÃO invente valid_to");
    expect(SINGLE_DAY_FLYER_VALIDITY_GUIDANCE).toContain("null");
  });
  it("is used by the actual visual extraction prompt", () => {
    const worker=readFileSync("supabase/functions/process-flyer-job/index.ts","utf8");
    expect(worker).toContain('import { SINGLE_DAY_FLYER_VALIDITY_GUIDANCE }');
    expect(worker).toContain("${SINGLE_DAY_FLYER_VALIDITY_GUIDANCE}");
    expect(worker).toContain("const EXTRACTION_PROMPT =");
  });
  it("keeps the final auto-import expiry and missing-date rejection", () => {
    const finalizer=readFileSync("supabase/functions/finalize-flyer-job/index.ts","utf8");
    expect(finalizer).toContain('if (!validTo)');
    expect(finalizer).toContain('VALIDITY_NOT_CONFIRMED');
    expect(finalizer).toContain('if (String(validTo) < today)');
    expect(finalizer).toContain('FLYER_EXPIRED');
  });
});
