/**
 * Some official SP NFC-e portal responses use HTTP 200 for an F5/WAF
 * "Request Rejected" support page (245 bytes, no fiscal line items).
 * This is an access denial, never a receipt layout change.
 * Must not retry with forged cookies, CAPTCHAs, or proxy rotation.
 */
export function isPortalAccessRejection(html: string): boolean {
  if (!html || html.length > 8192) return false;
  return /<title\s*>\s*Request Rejected\s*<\/title\s*>/i.test(html)
    && /(?:The requested URL was rejected|Your support ID is)/i.test(html);
}

/** Public, non-sensitive diagnostic category for caller-side recovery UI. */
export const PORTAL_REJECTION_CODE = "PORTAL_REJECTED";
