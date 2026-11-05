import { afterEach, describe, expect, it, vi } from "vitest";
import { stripJsonp, getJson, flyerRows } from "../../api/max-flyers";

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
