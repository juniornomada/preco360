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
Você analisa UMA captura de tela/foto de uma consulta oficial de NF-e/NFC-e/cupom fiscal brasileiro, normalmente aberta no portal da SEFAZ.

OBJETIVO
Transcreva os dados da compra visíveis na imagem, principalmente estabelecimento, data e TODOS os itens legíveis.

REGRAS IMPORTANTES
1. A imagem pode ser apenas uma parte de uma nota longa. Extraia somente o que estiver realmente visível; não invente itens ausentes.
2. supermarket deve ser o nome/razão social ou nome fantasia do estabelecimento emissor quando legível. Não use "SEFAZ", "Receita", "NFC-e", "NF-e" ou o portal como supermercado.
3. date deve ser a data de emissão/compra no formato YYYY-MM-DD. Se houver data e hora, use somente a data.
4. Cada item deve conter o nome comercial/descrição legível em name.
5. quantity é a quantidade comprada. Preserve decimais, por exemplo 0.742 para produto vendido por kg.
6. unit é EXCLUSIVAMENTE a unidade de venda exibida na linha fiscal/coluna de unidade: UN, KG, G, L, ML, CX, PCT, PC etc. Padronize UND/UNID como UN e LT como L.
   - NÃO use peso, volume ou capacidade que faça parte da descrição do produto como unit.
   - Exemplo: "REF FANTA ... 1L" comprado como 1 UN => quantity=1 e unit="UN", não "L".
   - Exemplo: "SC LIXO ECOLIX 100L" comprado como 1 PC/UN => unit="PC" ou "UN"; "100L" é capacidade do saco, não unidade de venda.
7. unitPrice é o valor unitário cobrado. Em item vendido por KG, é o preço por kg mostrado na nota.
8. totalPrice é o total daquele item/linha após quantidade × preço unitário, quando legível.
9. price deve repetir unitPrice quando unitPrice existir; caso contrário use totalPrice. Nunca use o total geral da nota como preço de um produto.
10. Desconto geral, troco, pagamento, tributos, CPF/CNPJ, chave de acesso e total da nota NÃO são produtos.
11. Se a mesma descrição aparecer duas vezes em linhas diferentes da própria nota, preserve as duas linhas; não una sem evidência.
12. Não transforme código/EAN em nome do produto.
13. Se algum campo do item não estiver legível, use null. Para aceitar um item, name e pelo menos unitPrice ou totalPrice precisam estar legíveis.
14. confidence deve refletir a confiança real da leitura. Omita itens com confidence abaixo de 0,65.
15. Examine toda a imagem, inclusive texto pequeno, linhas parcialmente visíveis e colunas de quantidade/valor.
16. Retorne SOMENTE JSON válido, sem markdown.

Estrutura exata:
{
  "supermarket": "nome do estabelecimento ou null",
  "date": "YYYY-MM-DD ou null",
  "items": [
    {
      "name": "descrição do item",
      "quantity": null,
      "unit": null,
      "unitPrice": null,
      "totalPrice": null,
      "price": 0,
      "confidence": 0.95
    }
  ]
}

Se não houver nenhum item legível, retorne {"supermarket":null,"date":null,"items":[]}.
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
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1));
    throw new Error("A leitura da imagem retornou JSON inválido.");
  }
}

function positive(value: unknown) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const number = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function decimalText(value: unknown) {
  const number = positive(value);
  if (number == null) return undefined;
  return String(number);
}

function moneyText(value: unknown) {
  const number = positive(value);
  if (number == null) return undefined;
  return number.toFixed(2);
}

function normalizeUnit(value: unknown) {
  const unit = String(value ?? "").trim().toUpperCase();
  if (!unit) return undefined;
  if (unit === "UND" || unit === "UNID" || unit === "UNIDADE") return "UN";
  if (unit === "LT") return "L";
  return unit;
}

function normalizeDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return null;
}

async function callGemini(model: string, apiKey: string, mimeType: string, data: string) {
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
          contents: [{
            role: "user",
            parts: [
              { text: PROMPT },
              { inlineData: { mimeType, data } },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 8192,
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
        message: "A leitura de imagem ainda não está configurada.",
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(400, { error: "FILE_REQUIRED", message: "Envie um print da nota." });
    }
    if (!file.type.startsWith("image/")) {
      return json(415, { error: "IMAGE_REQUIRED", message: "O arquivo precisa ser uma imagem." });
    }
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
      return json(400, {
        error: "INVALID_IMAGE_SIZE",
        message: "Cada imagem precisa ter até 12 MB.",
      });
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
        const items = (Array.isArray(parsed?.items) ? parsed.items : [])
          .map((item: any) => {
            const name = String(item?.name ?? "").replace(/\s+/g, " ").trim();
            const confidence = Number(item?.confidence);
            const unitPrice = moneyText(item?.unitPrice);
            const totalPrice = moneyText(item?.totalPrice);
            const price = moneyText(item?.price) ?? unitPrice ?? totalPrice;
            if (
              !name ||
              !price ||
              !Number.isFinite(confidence) ||
              confidence < 0.65
            ) {
              return null;
            }
            return {
              name,
              price,
              quantity: decimalText(item?.quantity),
              unit: normalizeUnit(item?.unit),
              unitPrice: unitPrice ?? (totalPrice ? undefined : price),
              totalPrice,
              confidence,
            };
          })
          .filter(Boolean)
          .slice(0, 350);

        attempts[attempts.length - 1].outcome = items.length ? "success" : "no_items";
        return json(200, {
          supermarket: parsed?.supermarket
            ? String(parsed.supermarket).replace(/\s+/g, " ").trim()
            : "",
          date: normalizeDate(parsed?.date),
          items,
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
      error: "RECEIPT_IMAGE_ANALYSIS_FAILED",
      message: error instanceof Error ? error.message : "Falha ao analisar o print.",
    });
  }
});
