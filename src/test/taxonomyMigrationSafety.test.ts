import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = (name: string) =>
  readFileSync(new URL("../../supabase/migrations/" + name, import.meta.url), "utf8");

const batchFiles = [
  "20261018190700_backfill_flyer_taxonomy_batch_1.sql",
  "20261018190800_backfill_flyer_taxonomy_batch_2.sql",
  "20261018190900_backfill_flyer_taxonomy_batch_3.sql",
  "20261018191000_backfill_flyer_taxonomy_batch_4.sql",
];

describe("production taxonomy deployment safeguards", () => {
  it("snapshots original catalog metadata BEFORE package/image/category migrations", () => {
    const snapshot = sql("20261018184000_snapshot_product_taxonomy_before_change.sql");
    expect(snapshot).toContain("original_category");
    expect(snapshot).toContain("original_package_size");
    expect(snapshot).toContain("original_image_url");
    expect(snapshot).toContain("ON CONFLICT (product_id) DO NOTHING");
    expect(snapshot).toContain("REVOKE ALL");
    expect("20261018184000").toBeLessThan("20261018184500");
  });

  it("never alters prices or product matching keys in backfill", () => {
    const names = ["20261018190600_backfill_product_taxonomy.sql", ...batchFiles];
    for (const name of names) {
      const body = sql(name);
      expect(body).not.toMatch(/\bUPDATE\s+(?:public\.)?prices\b/i);
      expect(body).not.toMatch(/\bSET\s+product_id\s*=/i);
      expect(body).not.toMatch(/\bDELETE\s+FROM\s+(?:public\.)?prices\b/i);
    }
  });

  it("partitions flyer updates exactly once over all hash residues", () => {
    for (const [index, name] of batchFiles.entries()) {
      const body = sql(name);
      expect(body).toContain(`% 4 = ${index}`);
      expect(body).toContain("IS DISTINCT FROM");
      expect(body).toContain("taxonomy_confidence");
    }
  });

  it("preserves explicitly chosen categories and restricts unknown potatoes", () => {
    const body = sql("20261018190500_product_taxonomy_classifier.sql");
    expect(body).toContain("NEW.category = 'Geral'");
    expect(body).toContain("confidence = 'high'");
    expect(body).toContain("n.normalized ~ '^batatas?");
    expect(body).toContain("r.priority BETWEEN 1 AND 100");
  });
});
