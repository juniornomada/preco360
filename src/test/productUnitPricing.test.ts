import {describe,it,expect} from "vitest";
import {unitPackageFromProduct,unitPriceForProduct} from "@/lib/productUnitPricing";

describe("normalized historical grocery prices",()=>{
  it("converts 900ml oil even when its receipt has no explicit ml field",()=>{
    const price=unitPriceForProduct("OLEO SOJA VILA VEL.900",null,null,6.58);
    expect(price?.baseUnit).toBe("l");
    expect(price?.normalizedPrice).toBeCloseTo(6.58/.9,2);
    expect(price?.inferred).toBe(true);
  });
  it("prioritizes the real declared unit and handles kilogram and multipacks",()=>{
    expect(unitPriceForProduct("Óleo de soja 900ml",900,"ml",6.58)?.normalizedPrice).toBeCloseTo(7.31,2);
    expect(unitPriceForProduct("Feijão carioca 500g",500,"g",3.59)?.normalizedPrice).toBeCloseTo(7.18,2);
    expect(unitPriceForProduct("Arroz 1kg",1,"kg",5.49)?.baseUnit).toBe("kg");
    expect(unitPriceForProduct("Refrigerante 2L",null,null,9.98)?.normalizedPrice).toBeCloseTo(4.99,2);
  });
  it("infers grams for truncated corn-starch receipt names with a trailing package size",()=>{
    const pack=unitPackageFromProduct("AMIDO MILHO KIMIMO 500",null,null);
    expect(pack?.pkg.baseUnit).toBe("kg");
    expect(pack?.pkg.baseQuantity).toBeCloseTo(0.5,4);
    expect(pack?.inferred).toBe(true);
    expect(unitPriceForProduct("AMIDO MILHO KIMIMO 500",null,null,8.90)?.normalizedPrice)
      .toBeCloseTo(17.80,2);
  });
  it("does not treat explicit fiscal codes as package sizes",()=>{
    expect(unitPackageFromProduct("AMIDO MILHO KIMIMO COD 500",null,null)).toBeNull();
    expect(unitPackageFromProduct("AMIDO MILHO KIMIMO SKU 500",null,null)).toBeNull();
  });
  it("does not invent a unit for product descriptions without trustworthy quantity",()=>{
    expect(unitPackageFromProduct("OLEO DE SOJA MARCA A",null,null)).toBeNull();
    expect(unitPriceForProduct("MANTEIGA MARCA B",null,null,8.79)).toBeNull();
  });
});