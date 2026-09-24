import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["observation"],
  properties: {
    observation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "product_name",
        "brand",
        "barcode",
        "package_quantity",
        "package_unit",
        "retail_price",
        "wholesale_price",
        "wholesale_min_quantity",
        "price_basis_quantity",
        "price_basis_unit",
        "notes",
        "confidence",
      ],
      properties: {
        product_name: { type: "string" },
        brand: { type: ["string", "null"] },
        barcode: { type: ["string", "null"] },
        package_quantity: { type: ["number", "null"] },
        package_unit: { type: ["string", "null"] },
        retail_price: { type: "number" },
        wholesale_price: { type: ["number", "null"] },
        wholesale_min_quantity: { type: ["integer", "null"] },
        price_basis_quantity: { type: ["number", "null"] },
        price_basis_unit: { type: ["string", "null"] },
        notes: { type: "array", items: { type: "string" } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
};

const PROMPT = `
Você analisa UMA foto de pesquisa presencial de preço em supermercado/atacadista. A foto NÃO é um tabloide.

OBJETIVO
Identifique o produto e o preço da etiqueta/cartaz que são o assunto principal da foto.

REGRAS
1. Escolha somente o produto ligado à etiqueta/cartaz principal, normalmente em destaque no centro ou na parte inferior. Ignore etiquetas e produtos secundários ao fundo.
2. Use a embalagem próxima da etiqueta para completar marca, linha/modelo, variante e tamanho. Não invente nada que não esteja visível.
3. product_name deve conter a identidade comercial útil do produto, sem o preço.
4. retail_price é o preço indicado como VAREJO. Se houver apenas um preço normal (inclusive placa manuscrita), use-o como retail_price.
5. wholesale_price é o preço indicado como ATACADO, ATACADO OU CREDIFFATO ou equivalente. Não substitua o varejo por ele.
6. wholesale_min_quantity é a quantidade mínima explicitamente indicada para conseguir o preço de atacado, por exemplo "A PARTIR DE 03 UNIDADES" => 3.
7. Se a etiqueta mostrar EAN legível, copie somente os dígitos para barcode. Se houver dúvida, use null.
8. package_quantity/package_unit representam o conteúdo da embalagem (ex.: 270 g, 5 L, 1,5 L, 350 ml, 1 kg).
9. price_basis_quantity/price_basis_unit representam a referência de preço quando explícita na etiqueta (ex.: "PREÇO REF: 1 Litro"). Caso não apareça, use null.
10. Coloque em notes informações úteis e objetivas que não caibam nos campos, sem repetir os preços.
11. Se não for possível associar com segurança produto + preço principal, retorne observation=null.
12. confidence deve refletir a leitura real. Abaixo de 0,65, prefira observation=null.
13. Retorne apenas JSON conforme o esquema, sem markdown.
`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function geminiText(payload: any) {
  for (const candidate of payload?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }
  return "";
}

function parseJson(text: string) {
  const clean = text
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();
  return JSON.parse(clean);
}

async function callGemini(model: string, apiKey: string, mimeType: string, data: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType, data } },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json(500, { error: "GEMINI_API_KEY_NOT_CONFIGURED" });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json(400, { error: "FILE_REQUIRED" });
    if (!file.type.startsWith("image/")) return json(415, { error: "IMAGE_REQUIRED" });
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      return json(400, { error: "INVALID_IMAGE_SIZE" });
    }

    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const configured = String(Deno.env.get("GEMINI_MODEL") || "").trim();
    const candidates = Array.from(new Set([configured, ...MODELS].filter(Boolean)));
    let lastError = "Nenhum modelo respondeu.";

    for (const model of candidates) {
      try {
        const { response, payload } = await callGemini(model, apiKey, file.type || "image/jpeg", data);
        if (!response.ok) {
          lastError = `Gemini ${response.status}: ${String(payload?.error?.message || "falha").slice(0, 500)}`;
          if ([429, 500, 502, 503, 504].includes(response.status)) continue;
          return json(response.status, { error: lastError });
        }

        const raw = geminiText(payload);
        if (!raw) {
          lastError = "A IA não retornou conteúdo.";
          continue;
        }

        const parsed = parseJson(raw);
        const observation = parsed?.observation ?? null;
        if (!observation) {
          return json(200, { observation: null, model });
        }

        const retailPrice = Number(observation.retail_price);
        const confidence = Number(observation.confidence);
        if (
          !String(observation.product_name || "").trim() ||
          !Number.isFinite(retailPrice) ||
          retailPrice <= 0 ||
          !Number.isFinite(confidence) ||
          confidence < 0.65
        ) {
          return json(200, { observation: null, model });
        }

        return json(200, { observation, model });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return json(502, { error: lastError });
  } catch (error) {
    return json(500, {
      error: error instanceof Error ? error.message : "Falha ao analisar a foto.",
    });
  }
});
