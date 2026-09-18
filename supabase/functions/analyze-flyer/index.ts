import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_PROMPT = `
Você é o extrator visual do Radar 360. Leia o encarte como uma pessoa olhando cada página, não como texto corrido de OCR.

OBJETIVO
Faça uma varredura completa do documento e devolva todas as ofertas que conseguir identificar com segurança, em JSON estruturado.

REGRAS OBRIGATÓRIAS
1. Nunca invente nome, preço, peso, sabor, loja ou condição. Se não conseguir ler nome + preço com segurança, ignore a oferta.
2. Um produto distinto = um registro. Se o encarte disser "Abóbora ... OU Repolho ... R$ 1,85/kg", crie DOIS registros, ambos a R$ 1,85/kg.
3. Variações do MESMO produto (sabores, cores, tipos) permanecem em um registro. Preencha included_types quando os tipos estiverem legíveis.
4. Se houver "tipos, exceto X/Y", mantenha o produto em um registro e coloque X/Y em excluded_types. Não misture a exceção no nome do produto.
5. Preço Clube/Vantagens deve ficar em club_price. O preço normal fica em price. Não substitua o preço normal pelo Clube.
6. Preserve a base original do anúncio em price_basis_quantity e price_basis_unit. Exemplos:
   - R$ 1,85/kg => 1 + kg
   - R$ 2,75 a cada 100g => 100 + g
   - pacote 600g por R$ 25,90 => package_quantity=600, package_unit=g e price_basis=1 un
7. package_quantity/package_unit representam o conteúdo da embalagem, não a base promocional, quando houver embalagem fechada.
8. Limites por cliente/compra vão em purchase_limit. Restrições de lojas/cidades vão em store_restrictions.
9. Mecânicas como "leve 12 pague 10", "leve 550g pague 500g", "vaso não incluso" e similares vão em notes.
10. product_name deve conter somente a identidade legível do produto, incluindo marca quando ela fizer parte natural do nome, mas sem preço, Clube, exceções ou restrições.
11. source_page é a página física do PDF, começando em 1.
12. confidence vai de 0 a 1. Só devolva registros com confiança >= 0.72.
13. Datas devem ser YYYY-MM-DD quando legíveis. Não deduza datas ausentes.
14. Preserve acentos e grafia do encarte quando legíveis.
15. Examine TODAS as páginas e TODAS as regiões: grade central, colunas laterais, rodapés e faixas promocionais.
16. Não pare após encontrar algumas dezenas de ofertas. Continue até o fim do documento.
17. Antes de finalizar, faça uma segunda varredura mental por página para encontrar células esquecidas.
18. Em produtos vendidos por peso, não confunda o preço com peso/volume. "1,35L" é embalagem de 1,35 litro, não preço de R$ 1,35.
19. Se um preço atende dois produtos separados por "ou", gere dois registros. Se "ou" apenas descreve variações do mesmo produto, mantenha um registro e coloque as variações em included_types.
20. Retorne JSON compacto, sem explicações fora do esquema.
`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["retailer", "valid_from", "valid_to", "page_count", "offers"],
  properties: {
    retailer: { type: ["string", "null"] },
    valid_from: { type: ["string", "null"] },
    valid_to: { type: ["string", "null"] },
    page_count: { type: ["integer", "null"] },
    offers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "product_name", "brand", "package_quantity", "package_unit", "price",
          "price_basis_quantity", "price_basis_unit", "club_price", "included_types",
          "excluded_types", "store_restrictions", "purchase_limit", "notes",
          "source_page", "confidence"
        ],
        properties: {
          product_name: { type: "string" },
          brand: { type: ["string", "null"] },
          package_quantity: { type: ["number", "null"] },
          package_unit: { type: ["string", "null"] },
          price: { type: "number" },
          price_basis_quantity: { type: "number" },
          price_basis_unit: { type: "string" },
          club_price: { type: ["number", "null"] },
          included_types: { type: "array", items: { type: "string" } },
          excluded_types: { type: "array", items: { type: "string" } },
          store_restrictions: { type: "array", items: { type: "string" } },
          purchase_limit: { type: ["string", "null"] },
          notes: { type: "array", items: { type: "string" } },
          source_page: { type: "integer", minimum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function geminiText(payload: any) {
  for (const candidate of payload?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

function parseJsonResponse(text: string) {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(unfenced.slice(start, end + 1));
    throw new Error(`Gemini retornou JSON inválido: ${unfenced.slice(0, 400)}`);
  }
}

function geminiError(status: number, payload: any) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    (typeof payload === "string" ? payload : "") ||
    "Falha ao analisar o tabloide.";
  const code = payload?.error?.status || payload?.error?.code || status;
  return `Gemini ${status}: ${code} · ${String(message).slice(0, 1200)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return json(503, {
      error: "VISION_NOT_CONFIGURED",
      message: "GEMINI_API_KEY não está configurada no projeto Supabase.",
    });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json(400, { error: "FILE_REQUIRED" });
    if (file.size <= 0) return json(400, { error: "EMPTY_FILE" });
    if (file.size > 18 * 1024 * 1024) {
      return json(413, {
        error: "FILE_TOO_LARGE",
        max_mb: 18,
        message: "O modo gratuito aceita no Radar 360 arquivos de até 18 MB por análise.",
      });
    }

    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    const allowed = mimeType === "application/pdf" || mimeType.startsWith("image/");
    if (!allowed) return json(415, { error: "UNSUPPORTED_FILE", mime: mimeType });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(bytes);
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                EXTRACTION_PROMPT +
                "\n\nExtraia todas as ofertas deste tabloide agora. Faça a leitura página por página e só finalize depois de revisar todas as páginas.",
            },
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 65536,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    const payload = await response.json().catch(async () => ({ message: await response.text() }));
    if (!response.ok) {
      throw new Error(geminiError(response.status, payload));
    }

    const text = geminiText(payload);
    if (!text) {
      const finishReason = payload?.candidates?.[0]?.finishReason;
      const blockReason = payload?.promptFeedback?.blockReason;
      throw new Error(
        `Gemini não retornou conteúdo estruturado${finishReason ? ` (finish: ${finishReason})` : ""}${blockReason ? ` (block: ${blockReason})` : ""}.`,
      );
    }

    const parsed: any = parseJsonResponse(text);

    const offers = Array.isArray(parsed?.offers)
      ? parsed.offers.filter(
          (offer: any) =>
            Number(offer?.confidence ?? 0) >= 0.72 &&
            Number.isFinite(Number(offer?.price)) &&
            Number(offer.price) > 0 &&
            typeof offer?.product_name === "string" &&
            offer.product_name.trim(),
        )
      : [];

    if (!offers.length) {
      throw new Error("Gemini terminou a leitura, mas não retornou nenhuma oferta confiável.");
    }

    return json(200, {
      ok: true,
      engine: "gemini-vision",
      model,
      retailer: parsed.retailer ?? null,
      valid_from: parsed.valid_from ?? null,
      valid_to: parsed.valid_to ?? null,
      page_count: parsed.page_count ?? null,
      offers,
    });
  } catch (error) {
    console.error("analyze-flyer", error);
    return json(500, {
      error: "VISION_ANALYSIS_FAILED",
      message: error instanceof Error ? error.message : "Falha na análise visual com Gemini.",
    });
  }
});
