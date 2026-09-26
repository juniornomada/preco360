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
Você analisa UMA captura de tela do aplicativo de um supermercado/atacadista.
A imagem pode conter UMA OU VÁRIAS ofertas.

OBJETIVO
Extraia todas as ofertas promocionais legíveis na captura.

REGRAS
1. Cada oferta deve representar um produto real visível na tela.
2. product_name deve conter o nome comercial útil COMPLETO e incluir a marca quando ela estiver visível, mesmo que brand também seja preenchido. Ex.: "Energético Baly Sabores Lata", e não apenas "Energético Sabores Lata".
3. brand deve ser a marca quando estiver claramente visível; caso contrário null.
4. package_quantity/package_unit representam o conteúdo da embalagem: 200 g, 1 kg, 350 ml, 5 L etc.
5. promotional_price é o preço que será cobrado no caixa após a oferta do app estar ativada.
6. regular_price é o preço normal/anterior apenas quando estiver explicitamente visível; caso contrário null.
7. valid_from e valid_to devem usar YYYY-MM-DD. Extraia a vigência mostrada na oferta.
8. Se aparecer apenas "válido até DD/MM" ou equivalente e o início não estiver visível, use valid_from=null.
9. app_activation_required deve ser true quando a oferta depender de ativação/cupom no app.
10. app_activated deve ser true somente quando a tela indicar que a oferta/cupom já está ativada/selecionada. Se não for possível confirmar, use null.
11. notes deve guardar condições úteis como limite de unidades, CPF, forma de pagamento ou texto promocional relevante.
12. Não confunda preço parcelado, economia percentual ou preço anterior com promotional_price.
13. Não invente datas, peso, preço ou nome.
14. confidence deve refletir a leitura. Abaixo de 0,65, omita a oferta.
15. Retorne SOMENTE JSON válido, sem markdown.

Estrutura:
{
  "offers": [
    {
      "product_name": "nome do produto",
      "brand": null,
      "package_quantity": null,
      "package_unit": null,
      "promotional_price": 0,
      "regular_price": null,
      "valid_from": null,
      "valid_to": "2026-09-30",
      "app_activation_required": true,
      "app_activated": true,
      "notes": [],
      "confidence": 0.95
    }
  ]
}

Se nenhuma oferta puder ser lida com segurança, retorne {"offers":[]}.
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
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

function parseJson(text: string) {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("Gemini retornou JSON inválido.");
  }
}

function normalizeDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }

  return null;
}

async function callGemini(model: string, apiKey: string, mimeType: string, data: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

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
            maxOutputTokens: 4096,
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json(503, {
        error: "VISION_NOT_CONFIGURED",
        message: "GEMINI_API_KEY não está configurada.",
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(400, { error: "FILE_REQUIRED", message: "Envie uma captura de tela." });
    }
    if (!file.type.startsWith("image/")) {
      return json(415, { error: "IMAGE_REQUIRED", message: "O arquivo precisa ser uma imagem." });
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      return json(400, { error: "INVALID_IMAGE_SIZE", message: "A imagem precisa ter até 12 MB." });
    }

    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const configured = String(Deno.env.get("GEMINI_MODEL") || "").trim();
    const allowed = new Set<string>(MODELS);
    const preferred = allowed.has(configured) ? configured : MODELS[0];
    const candidates = Array.from(new Set([preferred, ...MODELS]));
    const attempts: Array<{ model: string; status: number; outcome?: string }> = [];
    let lastError = "Nenhum modelo respondeu.";

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
          lastError = String(payload?.error?.message || payload?.message || `HTTP ${response.status}`);
          if ([403, 404, 429].includes(response.status) || response.status >= 500) continue;
          return json(response.status, {
            error: "VISION_REQUEST_REJECTED",
            message: lastError,
            attempted_models: attempts,
          });
        }

        const raw = geminiText(payload);
        if (!raw) {
          attempts[attempts.length - 1].outcome = "empty";
          continue;
        }

        const parsed = parseJson(raw);
        const rawOffers = Array.isArray(parsed?.offers) ? parsed.offers : [];
        const offers = rawOffers
          .map((offer: any) => {
            const price = Number(offer?.promotional_price);
            const confidence = Number(offer?.confidence);
            if (
              !String(offer?.product_name || "").trim() ||
              !Number.isFinite(price) ||
              price <= 0 ||
              !Number.isFinite(confidence) ||
              confidence < 0.65
            ) {
              return null;
            }

            const regular = Number(offer?.regular_price);
            return {
              product_name: String(offer.product_name).trim(),
              brand: offer.brand ? String(offer.brand).trim() : null,
              package_quantity:
                offer.package_quantity == null ? null : Number(offer.package_quantity),
              package_unit:
                offer.package_unit == null ? null : String(offer.package_unit).trim(),
              promotional_price: price,
              regular_price:
                Number.isFinite(regular) && regular > 0 ? regular : null,
              valid_from: normalizeDate(offer.valid_from),
              valid_to: normalizeDate(offer.valid_to),
              app_activation_required: offer.app_activation_required !== false,
              app_activated:
                typeof offer.app_activated === "boolean" ? offer.app_activated : null,
              notes: Array.isArray(offer.notes)
                ? offer.notes.map((item: unknown) => String(item)).filter(Boolean)
                : [],
              confidence,
            };
          })
          .filter(Boolean);

        attempts[attempts.length - 1].outcome = offers.length ? "success" : "no_offers";

        return json(200, {
          offers,
          model,
          attempted_models: attempts,
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return json(503, {
      error: "VISION_MODELS_UNAVAILABLE",
      message: lastError,
      retryable: true,
      attempted_models: attempts,
    });
  } catch (error) {
    return json(500, {
      error: "APP_OFFER_ANALYSIS_FAILED",
      message: error instanceof Error ? error.message : "Falha ao analisar a captura.",
    });
  }
});
