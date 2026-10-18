import { describe, it, expect } from "vitest";
import { evaluateFlyerOffer, inferPackage } from "@/lib/flyerAnalysis";
import { chooseHistoricalReference, historicalReferenceScopeLabel } from "@/lib/referenceBrandScope";

const melitta = {
  rawName: "Cappuccino Melitta lata / tipos / 200g",
  brand: "Melitta", price: 13.98,
  packageInfo: inferPackage("200g")!,
  normalizedPrice: 13.98 / .2,
  baseUnit: "kg" as const, clubPrice: false, sourcePage: 1,
};

const history = [
  { raw_name:"Cappuccino 3 Corações tipos / 200g",brand:"3 Corações",
    advertised_price:17.90, normalized_price:89.5,package_quantity:200,package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações 200g",brand:"3 Corações",
    advertised_price:17.90, normalized_price:89.5,package_quantity:200,package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações/ Pt 200g",brand:"3 Corações",
    advertised_price:17.90,club_advertised_price:16.39, normalized_price:89.5,
    package_quantity:200,package_unit:"g" },
  { raw_name:"Cappuccino 3 Corações Pt 200g",brand:"3 Corações",
    advertised_price:16.89, normalized_price:84.45,package_quantity:200,package_unit:"g" },
];

describe("historical reference provenance", () => {
  it("marks the real Melitta / 3 Corações comparison as other-brand CATEGORY history",()=>{
    const verdict=evaluateFlyerOffer(melitta,null,history);
    expect(verdict.referencePrice).toBeCloseTo(86.975,3);
    expect(verdict.deltaPct).toBeCloseTo((69.9/86.975-1)*100,3);
    expect(verdict.provenance).toEqual({
      referenceScope:"category",referenceSource:"offer",referenceSampleCount:4,
      referenceBrands:["3 Corações"],
    });
    expect(historicalReferenceScopeLabel(verdict.provenance!))
      .toContain("Categoria · mediana de 4 ofertas anteriores (3 Corações)");
  });

  it("prioritizes Melitta history over 3 Corações when Melitta history becomes available",()=>{
    const verdict=evaluateFlyerOffer(melitta,null,[
      ...history,
      {raw_name:"Cappuccino Melitta lata 200g",brand:"Melitta",
        advertised_price:18.90,normalized_price:94.5,package_quantity:200,package_unit:"g"},
    ]);
    expect(verdict.referencePrice).toBeCloseTo(94.5);
    expect(verdict.provenance?.referenceScope).toBe("same_brand");
    expect(verdict.provenance?.referenceSampleCount).toBe(1);
    expect(verdict.provenance?.referenceBrands).toEqual(["Melitta"]);
  });

  it("marks only verified brand matches as same-brand",()=>{
    const reference=chooseHistoricalReference("Melitta",[],[
      {value:84.5,brand:null,name:"Cappuccino 3 Corações 200g"},
      {value:90,brand:"3 Corações",name:"Cappuccino 3 Corações 200g"},
    ]);
    expect(reference?.provenance.referenceScope).toBe("category");
  });

  it("does not mix other-brand purchases into an available same-brand offer history",()=>{
    const choice=chooseHistoricalReference("Melitta",[
      {value:84.5,brand:"3 Corações",name:"Cappuccino 3 Corações 200g"},
    ],[
      {value:80,brand:"Melitta",name:"Cappuccino Melitta 200g"},
    ]);
    expect(choice?.samples.map(entry=>entry.value)).toEqual([80]);
    expect(choice?.provenance.referenceSource).toBe("offer");
    expect(choice?.provenance.referenceScope).toBe("same_brand");
  });

  it("keeps old purchases ahead of category flyers only if brand has no verified match",()=>{
    const choice=chooseHistoricalReference("Melitta",[
      {value:84.5,brand:"3 Corações",name:"Cappuccino 3 Corações 200g"},
    ],history.map(entry=>({value:Number(entry.advertised_price)/.2,brand:entry.brand,name:entry.raw_name})));
    expect(choice?.provenance.referenceScope).toBe("category");
    expect(choice?.provenance.referenceSource).toBe("purchase");
  });
});
