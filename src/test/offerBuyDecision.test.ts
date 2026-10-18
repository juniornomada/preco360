import { describe, expect, it } from "vitest";
import { chooseHistoricalReference, historicalReferenceScopeLabel } from "@/lib/referenceBrandScope";
import { shouldBuyOffer } from "@/components/OfferBuyDecision";
import { evaluateFlyerOffer, inferPackage } from "@/lib/flyerAnalysis";

const provenance = {
  referenceScope: "category" as const,
  referenceSource: "offer" as const,
  referenceSampleCount: 4,
  referenceBrands: ["3 Corações"],
};

describe("clear yes/no purchase recommendations",()=>{
  it("reproduces Melitta versus 3 Corações as a category comparison",()=>{
    const current={
      rawName:"Cappuccino Melitta lata / tipos / 200g",
      brand:"Melitta", price:13.98,
      packageInfo: inferPackage("200g")!,
      normalizedPrice:69.9,
      baseUnit:"kg" as const,
      clubPrice:false, sourcePage:1,
    };
    const history=[
      {raw_name:"Cappuccino 3 Corações tipos / 200g",brand:"3 Corações",advertised_price:17.90,normalized_price:89.50,package_quantity:200,package_unit:"g"},
      {raw_name:"Cappuccino 3 Corações 200g",brand:"3 Corações",advertised_price:17.90,normalized_price:89.50,package_quantity:200,package_unit:"g"},
      {raw_name:"Cappuccino 3 Corações/ Pt 200g",brand:"3 Corações",advertised_price:16.39,normalized_price:81.95,package_quantity:200,package_unit:"g"},
      {raw_name:"Cappuccino 3 Corações Pt 200g",brand:"3 Corações",advertised_price:16.89,normalized_price:84.45,package_quantity:200,package_unit:"g"},
    ];
    const result=evaluateFlyerOffer(current,null,history);
    expect(result.referencePrice).toBeCloseTo(86.975,2);
    expect(result.provenance?.referenceScope).toBe("category");
    expect(result.provenance?.referenceBrands).toEqual(["3 Corações"]);
    expect(shouldBuyOffer(current.normalizedPrice,result)).toBe("yes");
    expect(historicalReferenceScopeLabel(result.provenance!)).toContain("Categoria");
    expect(historicalReferenceScopeLabel(result.provenance!)).toContain("3 Corações");
  });
  it("does not confuse one recent purchase with a median of previous offers",()=>{
    const selected=chooseHistoricalReference("Melitta",
      [{value:84.5,brand:"3 Corações",name:"Cappuccino 3 Corações 200g"}],
      [{value:89.5,brand:"3 Corações"},{value:81.95,brand:"3 Corações"}]);
    expect(selected?.provenance.referenceScope).toBe("category");
    expect(selected?.provenance.referenceSource).toBe("offer");
    expect(selected?.provenance.referenceSampleCount).toBe(2);
    expect(selected?.samples.map(x=>x.value)).toEqual([89.5,81.95]);
    const sparse=chooseHistoricalReference("Melitta",
      [{value:84.5,brand:"3 Corações"}],[]);
    expect(shouldBuyOffer(69.9,{referencePrice:84.5,provenance:sparse?.provenance??null})).toBe("insufficient");
  });
  it("prioritizes same-brand historical offers ahead of other-brand purchases",()=>{
    const result=chooseHistoricalReference("Melitta",
      [{value:50,brand:"3 Corações"}],
      [{value:75,brand:"Melitta"},{value:85,brand:"Melitta"},{value:40,brand:"3 Corações"}]);
    expect(result?.provenance.referenceScope).toBe("same_brand");
    expect(result?.provenance.referenceSource).toBe("offer");
    expect(result?.samples.map(x=>x.value)).toEqual([75,85]);
    expect(shouldBuyOffer(77,{referencePrice:80,provenance:result?.provenance??null})).toBe("yes");
  });
  it("never claims an unknown price is a bad deal",()=>{
    expect(shouldBuyOffer(75,{referencePrice:null,provenance:null})).toBe("insufficient");
    expect(shouldBuyOffer(95,{referencePrice:80,provenance})).toBe("no");
    expect(shouldBuyOffer(80,{referencePrice:80,provenance})).toBe("yes");
  });
});
