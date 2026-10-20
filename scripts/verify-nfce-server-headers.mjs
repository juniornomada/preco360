// Guard against accidental reintroduction of browser spoofing in server-only NFC-e calls.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const paths=[
 "supabase/functions/fetch-receipt-url/index.ts",
 "supabase/functions/sefaz-sp-nfce-live/index.ts",
 "supabase/functions/sefaz-sp-nfce-session/index.ts",
];
for (const path of paths) {
 const source=readFileSync(path,"utf8");
 assert.doesNotMatch(source,/["']User-Agent["']\s*:/i,`Browser User-Agent override present in ${path}`);
 assert.doesNotMatch(source,/A SEFAZ mudou o formulário da consulta/i,`Unsupported form-change diagnosis in ${path}`);
 if (path.includes("sefaz-sp-nfce")) {
  assert.match(source,/function isPortalRejected\(/,`Missing explicit WAF recognition in ${path}`);
  assert.match(source,/if \(isPortalRejected\(html\)\)/,`WAF detection not used in ${path}`);
 }
 console.log(`Verified headers and portal diagnostics: ${path}`);
}
