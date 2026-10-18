import { describe, expect, it } from "vitest";
import {
  classifyProductName, potatoProductKind, potatoReferenceKey,
} from "@/lib/productTaxonomy";

describe("conservative taxonomy across imported offers and receipt products", () => {
  it.each([
    ["Batata Baroa Kg (1kg)", "potatoFreshBaroa"],
    ["BATATA INGLESA kg", "potatoFreshCommon"],
    ["Batata doce rosada", "potatoFreshSweet"],
    ["Batata pré-frita McCain congelada 2kg", "potatoFrozen"],
    ["Batata palito Rap Newbraz (2kg)", "potatoFrozen"],
    ["Batata palha Yoki 100g", "potatoStraw"],
    ["Batata Lay's clássica 183g", "potatoSnack"],
    ["Batata Mister Potato tipos 100g", "potatoSnack"],
    ["BATATA UNI 130G", "potatoUnknown"],
  ] as const)("identifies %s", (name, kind) => {
    expect(potatoProductKind(name)).toBe(kind);
  });

  it("keeps ingredients and prepared foods out of potato-family offers", () => {
    expect(potatoProductKind("Pão Tauste de Batata")).toBeNull();
    expect(potatoProductKind("Purê de batata doce com frango desfiado")).toBeNull();
    expect(potatoProductKind("Sobrecoxa com batatas e arroz")).toBeNull();
  });

  it("never compares fresh baroa with inglesa or chips with palha", () => {
    expect(potatoReferenceKey("Batata Baroa 1kg")).not.toBe(potatoReferenceKey("Batata Inglesa 1kg"));
    expect(potatoReferenceKey("Batata Palha Yoki")).not.toBe(potatoReferenceKey("Batata Ruffles 68g"));
    expect(potatoReferenceKey("Batata Uni 130g")).toBeNull();
  });

  it("classifies unrelated purchases by head without potato contamination", () => {
    expect(classifyProductName("Pão de batata")).toMatchObject({ department: "Padaria" });
    expect(classifyProductName("BATATA PALHA UNI 100G")).toMatchObject({ category: "Batata palha" });
    expect(classifyProductName("MILHO VD.FERN.BD.00G")).toMatchObject({ kind: "milho:revisar" });
    expect(classifyProductName("Cafe Sol. 3 Coracoes")).toMatchObject({ department: "Mercearia" });
    expect(classifyProductName("Produto indefinido 100g")).toBeNull();
  });
});
