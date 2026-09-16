import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXTRACTION_PROMPT = `
Você é o extrator visual do Radar 360. Leia o encarte como uma pessoa olhando a página, não como texto corrido de OCR.

Objetivo: devolver somente ofertas que você consegue identificar com segurança a partir do arquivo visual.

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
12. confidence vai de 0 a 1. Não devolva registros abaixo de 0.72.
13. Datas devem ser YYYY-MM-DD quando legíveis. Não deduza datas ausentes.
14. Preserve acentos e grafia do encarte quando legíveis.
15. Faça uma varredura completa de todas as páginas e de todas as células/quadros de oferta, inclusive barras laterais e rodapés promocionais.
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
          source_page: { type: "integer" },
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

async function openAI(path: string, apiKey: string, init: RequestInit) {
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 1200)}`);
  }
  return response;
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return json(503, {
      error: "VISION_NOT_CONFIGURED",
      message: "OPENAI_API_KEY não está configurada no projeto Supabase.",
    });
  }

  let openAIFileId: string | null = null;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json(400, { error: "FILE_REQUIRED" });
    if (file.size <= 0) return json(400, { error: "EMPTY_FILE" });
    if (file.size > 20 * 1024 * 1024) return json(413, { error: "FILE_TOO_LARGE", max_mb: 20 });

    const allowed = file.type === "application/pdf" || file.type.startsWith("image/");
    if (!allowed) return json(415, { error: "UNSUPPORTED_FILE", mime: file.type });

    const upload = new FormData();
    upload.append("purpose", "user_data");
    upload.append("file", file, file.name || "tabloide");

    const uploadedResponse = await openAI("/files", apiKey, { method: "POST", body: upload });
    const uploaded = await uploadedResponse.json();
    openAIFileId = uploaded.id;

    const visualInput = file.type.startsWith("image/")
      ? { type: "input_image", file_id: openAIFileId, detail: "high" }
      : { type: "input_file", file_id: openAIFileId };

    const model = Deno.env.get("OPENAI_VISION_MODEL") || "gpt-5.6-sol";
    const body = {
      model,
      reasoning: { effort: "medium" },
      max_output_tokens: 50000,
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: EXTRACTION_PROMPT }],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Extraia todas as ofertas deste tabloide seguindo rigorosamente as regras. Priorize precisão; se um item estiver ilegível, omita-o.",
            },
            visualInput,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "radar_360_flyer",
          description: "Ofertas estruturadas extraídas visualmente de um tabloide de supermercado.",
          strict: true,
          schema,
        },
      },
    };

    const response = await openAI("/responses", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    const text = responseText(payload);
    if (!text) throw new Error("A análise visual não retornou conteúdo estruturado.");

    const parsed = JSON.parse(text);
    const offers = Array.isArray(parsed.offers)
      ? parsed.offers.filter((offer: any) => Number(offer?.confidence ?? 0) >= 0.72 && Number(offer?.price) > 0)
      : [];

    return json(200, {
      ok: true,
      engine: "openai-vision",
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
      message: error instanceof Error ? error.message : "Falha na análise visual.",
    });
  } finally {
    if (openAIFileId && apiKey) {
      try {
        await openAI(`/files/${openAIFileId}`, apiKey, { method: "DELETE" });
      } catch (error) {
        console.warn("Could not delete temporary OpenAI file", error);
      }
    }
  }
});
