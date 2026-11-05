import { afterEach, describe, expect, it, vi } from "vitest";
import maxService, { stripJsonp, getJson, flyerRows, MAX_OFFER_ATTEMPTS, MAX_OFFER_TIMEOUT_MS } from "../../api/max-flyers";

// Based on the actual Max response inspected for Marília store #150,
// on 04/11/2026. The official image filenames contain parentheses.
const payload = {
  offers: [
    {
      flyer: [
        {
          item: [
            {
              id: "146709",
              type: "1",
              image: "//institucional.supermuffato.com.br/webtools/files/ofertas/146709/0101flv--max--marilia-- (1).jpeg",
              isCover: true,
              width: "2266",
              height: "3098",
              position: "24563",
            },
            {
              id: "146709",
              type: "1",
              image: "//institucional.supermuffato.com.br/webtools/files/ofertas/146709/0101flv--max--marilia-- (2).jpeg",
              isCover: false,
              width: "2266",
              height: "3098",
              position: "24564",
            },
          ],
        },
      ],
    },
  ],
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Max official offers response and JSONP handling", () => {
  it("never strips parentheses inside a raw JSON flyer filename", () => {
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("(1).jpeg");
    expect(stripJsonp(serialized)).toBe(serialized);
    expect(JSON.parse(stripJsonp(serialized))).toEqual(payload);
  });

  it("allows actual getStores JSONP wrapper", () => {
    const stores = [{cdLoja:"150",nmCidade:"Marília",nmLoja:"Max Atacadista Marília Esmeralda"}];
    expect(JSON.parse(stripJsonp("getStores( " + JSON.stringify(stores) + " );"))).toEqual(stores);
  });

  it("keeps all JSON bytes intact with nested parentheses in multiple flyers", () => {
    const text = JSON.stringify({
      offers:[payload.offers[0],payload.offers[0]],
      note:"(encarte (1))",
    });
    expect(stripJsonp(text)).toBe(text);
    expect(JSON.parse(stripJsonp(text)).offers).toHaveLength(2);
  });

  it("does not mistake other non-JSON text for JSONP", () => {
    const html="<html><body>temporary(1).jpeg</body></html>";
    expect(stripJsonp(html)).toBe(html);
  });

  it("decodes the actual JSON through the existing Max bridge and emits two image pages", async () => {
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify(payload),{
      status:200,headers:{"content-type":"application/json"},
    }));
    vi.stubGlobal("fetch",fetchMock);
    const response=await getJson("https://institucional.supermuffato.com.br/official",1);
    const rows=flyerRows(response,{
      id:"150",name:"Max Atacadista Marília Esmeralda",city:"Marília",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].pages).toHaveLength(2);
    expect(rows[0].id).toBe("146709");
    expect(rows[0].pages[0].url).toContain("(1).jpeg");
    expect(rows[0].pages[1].url).toContain("(2).jpeg");
  });
});

describe("Slow Max offers service (timeout resilience)", () => {
  const firstStore = [{
    cdLoja:"150", nmCidade:"Marília",
    nmLoja:"Max Atacadista Marília Esmeralda",
  }];

  it("uses a longer bounded deadline for offers without changing store-list retries", () => {
    expect(MAX_OFFER_TIMEOUT_MS).toBe(16000);
    expect(MAX_OFFER_ATTEMPTS).toBe(2);
  });

  it("accepts the actual Max offers payload after 10 seconds instead of aborting at 9", async () => {
    vi.useFakeTimers();
    const fetchMock=vi.fn().mockImplementation((url: string, options: RequestInit) => {
      if (url.includes("getStores")) {
        return Promise.resolve(new Response("getStores(" + JSON.stringify(firstStore) + ")",{status:200}));
      }
      return new Promise<Response>((resolve,reject) => {
        const id=setTimeout(() => resolve(new Response(JSON.stringify(payload),{status:200})), 10500);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(id);
          reject(new DOMException("This operation was aborted", "AbortError"));
        },{once:true});
      });
    });
    vi.stubGlobal("fetch",fetchMock);
    const promise=maxService.fetch();
    await vi.advanceTimersByTimeAsync(10900);
    const response=await promise;
    const output=await response.json();
    expect(response.status).toBe(200);
    expect(output.capture_ready).toBe(true);
    expect(output.store_errors).toEqual([]);
    expect(output.flyers).toHaveLength(1);
    expect(output.flyers[0].pages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports the real deadline rather than a generic aborted message", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch",vi.fn().mockImplementation((_url: string, options: RequestInit) =>
      new Promise((_resolve,reject) => {
        options.signal?.addEventListener("abort",() =>
          reject(new DOMException("This operation was aborted","AbortError")), {once:true});
      }),
    ));
    const pending=getJson("https://institucional.supermuffato.com.br/offers",1,120);
    const settled=expect(pending).rejects.toThrow("não respondeu em 0 segundos");
    await vi.advanceTimersByTimeAsync(121);
    await settled;
  });
});
