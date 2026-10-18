import { describe, expect, it } from "vitest";
import { evaluateFlyerOffer, inferPackage } from "@/lib/flyerAnalysis";
import {
  chooseHistoricalReference,
  historicalReferenceScopeLabel,
} from "@/lib/referenceBrandScope";

const candidate = {
  rawName:"Cappuccino Melitta lata / tipos / 200g",
  brand:"Melitta",
  price:13.98,
  packageInfo:inferPackage("200g")!,
  normalizedPrice:69.90,
  baseUnit:"kg" as const,
  clubPrice:false,
  sourcePage:1,
};
const previous3Coracoes = [
  { raw_name:"Cappuccino 3 Corações tipos / 200g", brand:"3 Corações", advertised_price:17.90, normalized_price:89.5, package_quantity:200, package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações 200g", brand:"3 Corações", advertised_price:17.90, normalized_price:89.5, package_quantity:200, package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações Pt 200g", brand:"3 Corações", advertised_price:16.89, normalized_price:84.45, package_quantity:200, package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações Pt 200g", brand:"3 Corações", advertised_price:17.90, club_advertised_price:16.39, normalized_price:89.5, package_quantity:200, package_unit:"g" },
];

describe("offer historical provenance and reference scopes", () => {
  it("does not call a 3 Corações median a Melitta price history", () => {
    const verdict=evaluateFlyerOffer(candidate, null, previous3Coracoes);
    expect(verdict.referencePrice).toBeCloseTo(86.975, 3);
    expect(verdict.provenance).toEqual({
      referenceScope:"category",
      referenceSource:"offer",
      referenceSampleCount:4,
      referenceBrands:["3 Corações"],
    });
    expect(verdict.deltaPct).toBeCloseTo((69.9/86.975-1)*100,3);
    expect(historicalReferenceScopeLabel(verdict.provenance!))
      .toContain("Categoria · mediana de 4 ofertas anteriores (3 Corações)");
  });

  it("uses matching Melitta offers before an unrelated brand median", () => {
    const withMelitta=[
      ...previous3Coracoes,
      {raw_name:"Cappuccino Melitta lata 200g",brand:"Melitta",advertised_price:15.98,normalized_price:79.9,package_quantity:200,package_unit:"g"}
    ];
    const verdict=evaluateFlyerOffer(candidate,null,withMelitta);
    expect(verdict.referencePrice).toBeCloseTo(79.9);
    expect(verdict.provenance?.referenceScope).toBe("same_brand");
    expect(verdict.provenance?.referenceSampleCount).toBe(1);
  });

  it("prefers a purchase from the same brand over any other category purchase",()=>{
    const result=chooseHistoricalReference("Melitta",[
      {value:84.5,brand:"3 Corações"},
      {value:75.0,brand:"Melitta"},
    ],[
      {value:69.5,brand:"Melitta"},
      {value:89.5,brand:"3 Corações"},
    ]);
    expect(result?.samples).toEqual([{value:75,brand:"Melitta"}]);
    expect(result?.provenance.referenceSource).toBe("purchase");
    expect(result?.provenance.referenceScope).toBe("same_brand");
  });

  it("does not hide a missing brand match by calling all other offers same-brand",()=>{
    const result=chooseHistoricalReference("Melitta",[
      {value:84.5,brand:null,name:"Cappuccino Solúvel 3 Corações 200g"},
    ],[]);
    expect(result?.provenance.referenceScope).toBe("category");
    expect(result?.provenance.referenceSource).toBe("purchase");
  });

  it("keeps no-history verdict clear when no comparable prices exist",()=>{
    const verdict=evaluateFlyerOffer(candidate,null,[]);
    expect(verdict.key).toBe("unknown");
    expect(verdict.referencePrice).toBeNull();
    expect(verdict.provenance).toBeNull();
  });
});