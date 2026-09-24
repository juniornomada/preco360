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

function cleanTranscript(value: string) {
  const firstLine =
    value
      .replace(/^```(?:text)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
      .split(/\r?\n/)[0]
      ?.trim() ?? "";

  return firstLine
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

async function transcribeWithGemini(
  model: string,
  apiKey: string,
  mimeType: string,
  data: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14_000);

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
                {
                  text: `Transcreva este áudio curto em português do Brasil.
É uma busca por produto de supermercado.
Retorne SOMENTE o texto reconhecido, em uma única linha, sem aspas e sem explicações.
Preserve marca, sabor, números e embalagem quando forem falados, por exemplo: "Heineken zero 350 ml", "suco de uva 1,5 litro", "Qboa 5 litros".
Não complete com informações que não foram faladas.`,
                },
                {
                  inlineData: {
                    mimeType,
                    data,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 80,
          },
        }),
      },
    );

    const payload = await response
      .json()
      .catch(async () => ({
        message: await response.text().catch(() => ""),
      }));

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
        error: "VOICE_NOT_CONFIGURED",
        message: "A transcrição por voz não está configurada.",
      });
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json(400, {
        error: "AUDIO_REQUIRED",
        message: "Nenhum áudio foi recebido.",
      });
    }

    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      return json(400, {
        error: "INVALID_AUDIO_SIZE",
        message: "O áudio precisa ter até 4 MB.",
      });
    }

    const mimeType = String(file.type || "audio/webm").split(";")[0];
    if (!mimeType.startsWith("audio/")) {
      return json(415, {
        error: "AUDIO_REQUIRED",
        message: "O arquivo precisa ser de áudio.",
      });
    }

    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));

    let lastError = "Não consegui transcrever o áudio.";
    const attempts: Array<{ model: string; status: number }> = [];

    for (const model of MODELS) {
      try {
        const { response, payload } = await transcribeWithGemini(
          model,
          apiKey,
          mimeType,
          data,
        );

        attempts.push({ model, status: response.status });

        if (!response.ok) {
          lastError = String(
            payload?.error?.message ||
              payload?.message ||
              `Gemini respondeu ${response.status}.`,
          );

          if (
            response.status === 429 ||
            response.status === 404 ||
            response.status === 403 ||
            response.status >= 500
          ) {
            continue;
          }

          return json(response.status, {
            error: "VOICE_TRANSCRIPTION_REJECTED",
            message: lastError,
          });
        }

        const transcript = cleanTranscript(geminiText(payload));
        if (!transcript) {
          lastError = "Não consegui identificar uma fala no áudio.";
          continue;
        }

        return json(200, { transcript, model });
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Falha na transcrição.";
      }
    }

    return json(503, {
      error: "VOICE_TRANSCRIPTION_UNAVAILABLE",
      message: lastError,
      retryable: true,
      attempted_models: attempts,
    });
  } catch (error) {
    return json(500, {
      error: "VOICE_TRANSCRIPTION_FAILED",
      message:
        error instanceof Error
          ? error.message
          : "Falha inesperada na transcrição.",
    });
  }
});
