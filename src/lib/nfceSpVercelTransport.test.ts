// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import server from "../../api/fetch-nfce-sp";
import {
  fetchSpNfceHtmlViaVercel,
  isOfficialSpNfceQrUrl,
} from "./nfceSpVercelTransport";

const validKey = "3".repeat(44);
const qr = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" +
  validKey + "|2|1|1|" + "a".repeat(40);

function request(value: string) {
  return new Request("https://preco360.vercel.app/api/fetch-nfce-sp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: value }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Official SP NFC-e URL validation", () => {
  it("accepts the known NFC-e consultation URL format", () => {
    expect(isOfficialSpNfceQrUrl(qr)).toBe(true);
  });

  it.each([
    "http://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" + validKey + "|2|1|1|" + "a".repeat(40),
    "https://evil.example/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" + validKey + "|2|1|1|" + "a".repeat(40),
    "https://www.nfce.fazenda.sp.gov.br.evil.example/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" + validKey + "|2|1|1|" + "a".repeat(40),
    "https://www.nfce.fazenda.sp.gov.br/admin?p=" + validKey + "|2|1|1|" + "a".repeat(40),
    "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" + validKey + "|2|1|1|" + "a".repeat(40) + "&redirect=https://evil.example",
    "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=invalid",
  ])("rejects non-QR or unsafe URL %s", (url) => {
    expect(isOfficialSpNfceQrUrl(url)).toBe(false);
  });
});

describe("Vercel server-side alternate SEFAZ transport", () => {
  it("fetches the official HTML on an allowlisted QR and returns it for existing parser", async () => {
    const html = "<html><body>DOCUMENTO AUXILIAR DA NOTA FISCAL DE CONSUMIDOR ELETRÔNICA</body></html>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await server.fetch(request(qr));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ html, source: "vercel" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const outgoingUrl = fetchMock.mock.calls[0][0] as URL;
    expect(outgoingUrl.hostname).toBe("www.nfce.fazenda.sp.gov.br");
  });

  it("does not fetch arbitrary addresses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await server.fetch(request("https://example.org/private"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports Vercel network reset without claiming SEFAZ was offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Connection reset by peer")));
    const res = await server.fetch(request(qr));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "UPSTREAM_NETWORK", source: "vercel" });
  });

  it("does not disguise access denied as valid receipt HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Forbidden", {status: 403})));
    const res = await server.fetch(request(qr));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("SEFAZ_ACCESS_DENIED");
  });

  it("does not follow redirects to external hosts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/download" },
    })));
    const res = await server.fetch(request(qr));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("UNEXPECTED_REDIRECT");
  });
});

describe("Browser helper for Vercel-to-Supabase parse fallback", () => {
  it("returns official HTML returned by the same-origin API", async () => {
    const html = "<html>" + "Cupom válido ".repeat(10) + "</html>";
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ html }),
    });
    vi.stubGlobal("fetch", fakeFetch);
    expect(await fetchSpNfceHtmlViaVercel(qr)).toBe(html);
    expect(fakeFetch.mock.calls[0][0]).toBe("/api/fetch-nfce-sp");
    expect(fakeFetch.mock.calls[0][1].method).toBe("POST");
  });

  it("returns null without network when the URL is not the official SP QR", async () => {
    const fakeFetch = vi.fn();
    vi.stubGlobal("fetch", fakeFetch);
    expect(await fetchSpNfceHtmlViaVercel("https://example.com")).toBe(null);
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
