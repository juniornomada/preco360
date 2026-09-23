const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];

function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function normalizeTranscript(value: string) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\"'“”‘’]+|[\"'“”‘’.,;:!?]+$/g, "")
    .trim();

  const key = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (key === "sau") return "sal";
  const poncaAliases = new Set([
    "ponca",
    "poncan",
    "poncam",
    "ponka",
    "ponkan",
    "ponkam",
    "poca",
    "pocan",
    "pocam",
    "pokan",
    "pokam",
  ]);

  if (poncaAliases.has(key)) {
    return "poncã";
  }

  return text;
}

function extractText(payload: any) {
  return String(
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada.");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Áudio não enviado." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Tamanho de áudio inválido." }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const audioBase64 = base64FromBytes(bytes);
    const mimeType = (file.type || "audio/webm").split(";")[0];

    const prompt =
      "Você transcreve uma busca de supermercado falada em português do Brasil. " +
      "Retorne SOMENTE JSON no formato {\"transcript\":\"...\"}. " +
      "Transcreva apenas o nome do produto realmente falado, sem acrescentar marca, tipo ou complemento. " +
      "Palavras curtas são válidas. Se a pessoa falar somente 'sal', retorne exatamente 'sal' — não acrescente 'refinado'. " +
      "Se ouvir poncã, poncan, ponkan, ponkam, ponca, pocã, pocan, pocam, pokan, pokam ou pronúncia equivalente da fruta, normalize para 'poncã'. " +
      "Se não houver fala inteligível, retorne {\"transcript\":\"\"}.";

    const configured = String(Deno.env.get("GEMINI_MODEL") || "").trim();
    const candidates = Array.from(new Set([configured, ...MODELS].filter(Boolean)));
    let lastError = "Nenhum modelo respondeu.";

    for (const model of candidates) {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          encodeURIComponent(model) +
          ":generateContent",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 64,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = String(payload?.error?.message || ("Gemini " + response.status));
        continue;
      }

      const raw = extractText(payload);
      let transcript = "";
      try {
        transcript = String(JSON.parse(raw)?.transcript || "");
      } catch {
        transcript = raw;
      }

      transcript = normalizeTranscript(transcript);

      return new Response(JSON.stringify({ transcript, model }), {
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    throw new Error(lastError);
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Falha na transcrição.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "content-type": "application/json" },
      },
    );
  }
});
