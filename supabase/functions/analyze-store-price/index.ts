import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
] as const;

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
13. Retorne SOMENTE JSON válido, sem markdown e sem texto fora do objeto.
14. Use exatamente esta estrutura, mantendo todos os campos:
{
  "observation": {
    "product_name": "nome do produto",
    "brand": null,
    "barcode": null,
    "package_quantity": null,
    "package_unit": null,
    "retail_price": 0,
    "wholesale_price": null,
    "wholesale_min_quantity": null,
    "price_basis_quantity": null,
    "price_basis_unit": null,
    "notes": [],
    "confidence": 0.95
  }
}
Quando não houver leitura confiável, retorne exatamente {"observation":null}.
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

  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }
    throw new Error("Gemini retornou JSON inválido.");
  }
}

function geminiError(status: number, payload: any) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    (typeof payload === "string" ? payload : "") ||
    "Falha ao analisar a foto.";
  const code = payload?.error?.status || payload?.error?.code || status;
  return `Gemini ${status}: ${code} · ${String(message).slice(0, 900)}`;
}

async function callGemini(
  model: string,
  apiKey: string,
  mimeType: string,
  data: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: PROMPT },
                { inlineData: { mimeType, data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    const payload = await response
      .json()
      .catch(async () => ({ message: await response.text().catch(() => "") }));

    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json(503, {
        error: "VISION_NOT_CONFIGURED",
        message: "GEMINI_API_KEY não está configurada no projeto Supabase.",
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(400, { error: "FILE_REQUIRED", message: "Envie uma imagem." });
    }
    if (!file.type.startsWith("image/")) {
      return json(415, { error: "IMAGE_REQUIRED", message: "O arquivo precisa ser uma imagem." });
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      return json(400, {
        error: "INVALID_IMAGE_SIZE",
        message: "A imagem precisa ter até 12 MB.",
      });
    }

    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const configured = String(Deno.env.get("GEMINI_MODEL") || "").trim();
    const freeSet = new Set<string>(MODELS);
    const preferred =
      (freeSet.has(configured) && configured) ||
      MODELS[0];
    const candidates = Array.from(new Set([preferred, ...MODELS]));

    let lastError = "Nenhum modelo respondeu.";
    const attempts: Array<{ model: string; status: number }> = [];

    for (const model of candidates) {
      try {
        const { response, payload } = await callGemini(
          model,
          apiKey,
          file.type || "image/jpeg",
          data,
        );

        attempts.push({ model, status: response.status });

        if (!response.ok) {
          lastError = geminiError(response.status, payload);
          console.error("analyze-store-price Gemini error", {
            model,
            status: response.status,
            message: String(payload?.error?.message || payload?.message || "").slice(0, 500),
          });

          if (
            response.status === 429 ||
            response.status === 404 ||
            response.status === 403 ||
            response.status >= 500
          ) {
            continue;
          }

          return json(response.status, {
            error: "VISION_REQUEST_REJECTED",
            message: lastError,
            attempted_models: attempts.map((item) => item.model),
          });
        }

        const raw = geminiText(payload);
        if (!raw) {
          lastError = "A IA não retornou conteúdo.";
          continue;
        }

        const parsed = parseJson(raw);
        const observation = parsed?.observation ?? null;
        if (!observation) {
          console.log("analyze-store-price no observation", {
            model,
            file: file.name,
            size: file.size,
          });
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

        console.log("analyze-store-price success", {
          model,
          file: file.name,
          size: file.size,
          confidence,
          product: String(observation.product_name || "").slice(0, 120),
        });

        return json(200, {
          observation: {
            product_name: String(observation.product_name).trim(),
            brand: observation.brand ? String(observation.brand).trim() : null,
            barcode: observation.barcode
              ? String(observation.barcode).replace(/\D/g, "") || null
              : null,
            package_quantity:
              observation.package_quantity == null
                ? null
                : Number(observation.package_quantity),
            package_unit:
              observation.package_unit == null
                ? null
                : String(observation.package_unit).trim(),
            retail_price: retailPrice,
            wholesale_price:
              observation.wholesale_price == null
                ? null
                : Number(observation.wholesale_price),
            wholesale_min_quantity:
              observation.wholesale_min_quantity == null
                ? null
                : Math.max(1, Math.trunc(Number(observation.wholesale_min_quantity))),
            price_basis_quantity:
              observation.price_basis_quantity == null
                ? null
                : Number(observation.price_basis_quantity),
            price_basis_unit:
              observation.price_basis_unit == null
                ? null
                : String(observation.price_basis_unit).trim(),
            notes: Array.isArray(observation.notes)
              ? observation.notes.map((item: unknown) => String(item)).filter(Boolean)
              : [],
            confidence,
          },
          model,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error("analyze-store-price exception", {
          model,
          message: lastError.slice(0, 500),
        });
      }
    }

    return json(503, {
      error: "VISION_MODELS_UNAVAILABLE",
      message: lastError,
      retryable: true,
      attempted_models: attempts.map((item) => item.model),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao analisar a foto.";
    console.error("analyze-store-price fatal", { message: message.slice(0, 500) });
    return json(500, { error: "STORE_PRICE_ANALYSIS_FAILED", message });
  }
});
