import { describe, expect, it } from "vitest";
import {
  isPortalAccessRejection,
  PORTAL_REJECTION_CODE,
} from "../../supabase/functions/fetch-receipt-url/portalResponse";

const rejectedHTML = `<html><head><title>Request Rejected</title></head><body>The requested URL was rejected. Please consult with your administrator.<br><br>Your support ID is: <10138580085375799346><br><br><a href='javascript:history.back();'>[Go Back]</body></html>`;

describe("São Paulo NFC-e gateway response detection", () => {
  it("recognizes the exact 245-character HTTP 200 denial page as PORTAL_REJECTED", () => {
    expect(rejectedHTML.length).toBe(245);
    expect(isPortalAccessRejection(rejectedHTML)).toBe(true);
    expect(PORTAL_REJECTION_CODE).toBe("PORTAL_REJECTED");
  });
  it("does not misinterpret normal receipt documents or a generic no-items page as WAF denial", () => {
    expect(isPortalAccessRejection("<html><body><span class='txtTit'>Leite 1L</span></body></html>")).toBe(false);
    expect(isPortalAccessRejection("<html><body>NFC-e indisponível</body></html>")).toBe(false);
    expect(isPortalAccessRejection("")).toBe(false);
  });
  it("rejects false matches without both signature markers", () => {
    expect(isPortalAccessRejection("<title>Request Rejected</title>")).toBe(false);
    expect(isPortalAccessRejection("The requested URL was rejected. Your support ID is: 123")).toBe(false);
    expect(isPortalAccessRejection(rejectedHTML.repeat(40))).toBe(false);
  });
});
