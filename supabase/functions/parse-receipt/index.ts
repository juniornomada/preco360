import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64, mimeType, ocrText } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const prompt = `Você é um especialista em ler cupons fiscais e DANFEs brasileiros.

Analise o texto OCR abaixo (e a imagem se fornecida) de um cupom fiscal ou DANFE brasileiro.

Extraia:
1. Nome do supermercado/loja
2. Lista de produtos com nome e preço total (valor final, não unitário)

REGRAS:
- Use o nome COMPLETO do produto como aparece no cupom
- O preço deve ser o valor TOTAL da linha (não o unitário)
- Ignore linhas de total, subtotal, troco, impostos, ICMS
- Ignore cabeçalhos e rodapés
- Se não conseguir identificar um produto, pule a linha
- Preços em formato brasileiro (vírgula = decimal)

Texto OCR:
"""
${ocrText || "Nenhum texto OCR disponível, analise apenas a imagem."}
"""

Responda APENAS com JSON válido neste formato exato:
{
  "supermarket": "Nome do Supermercado",
  "items": [
    {"name": "Nome do Produto", "price": "12.50"},
    {"name": "Outro Produto", "price": "8.99"}
  ]
}

Preços no JSON devem usar ponto como separador decimal.`;

    const messages: any[] = [{ role: "user", content: [] as any[] }];

    // Add image if provided
    if (imageBase64 && mimeType) {
      messages[0].content.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${imageBase64}` },
      });
    }

    messages[0].content.push({ type: "text", text: prompt });

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Gateway error: ${response.status} - ${errText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    // Extract JSON from response (may be wrapped in ```json ... ```)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Could not parse AI response as JSON");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in parse-receipt:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
