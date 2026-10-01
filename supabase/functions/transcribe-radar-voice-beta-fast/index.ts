import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";
const PRIMARY_TIMEOUT_MS = 3000;
const FALLBACK_TIMEOUT_MS = 2400;
const FALLBACK_DELAY_MS = 650;

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

function extractText(payload: any) {
  return String(
    payload?.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "",
  );
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

  const compactKey = key.replace(/[\s-]+/g, "");

  if (key === "sau") return "sal";

  const poncanAliases = new Set([
    "ponca", "poncan", "poncam", "ponka", "ponkan", "ponkam",
    "poca", "pocan", "pocam", "pokan", "pokam",
  ]);

  if (poncanAliases.has(key) || poncanAliases.has(compactKey)) return "poncan";
  return text;
}

function parseTranscript(payload: any) {
  return normalizeTranscript(extractText(payload));
}

function isSuspiciousTranscript(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  if (/https?:\/\/|www\.|\.[a-z]{2,}$/i.test(normalized)) {
    return true;
  }

  const tokens = new Set(normalized.split(/\s+/).filter(Boolean));
  const standaloneNonProductTerms = new Set([
    "feminino",
    "masculino",
    "sim",
    "não",
    "nao",
    "isso",
    "aquilo",
    "obrigado",
    "obrigada",
  ]);

  if (standaloneNonProductTerms.has(normalized)) {
    return true;
  }

  const fruitConflicts = ["laranja", "morango", "tangerina", "mexerica", "bergamota"];
  const hasPoncan =
    tokens.has("poncan") ||
    tokens.has("ponca") ||
    tokens.has("ponkan") ||
    tokens.has("pocan");

  return hasPoncan && fruitConflicts.some((fruit) => tokens.has(fruit));
}

function createModelAttempt(
  model: string,
  timeoutMs: number,
  apiKey: string,
  prompt: string,
  mimeType: string,
  audioBase64: string,
) {
  const controller = new AbortController();

  const promise = (async () => {
    const startedAt = performance.now();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
          signal: controller.signal,
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
              maxOutputTokens: 16,
              thinkingConfig: {
                thinkingLevel: "minimal",
              },
            },
          }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      const elapsedMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        throw new Error(`${model}:HTTP_${response.status}:${elapsedMs}`);
      }

      const transcript = parseTranscript(payload);
      if (!transcript) {
        throw new Error(`${model}:EMPTY:${elapsedMs}`);
      }

      if (isSuspiciousTranscript(transcript)) {
        console.log(
          JSON.stringify({
            event: "beta_voice_candidate_rejected",
            transcript,
            model,
            model_ms: elapsedMs,
          }),
        );
        throw new Error(`${model}:SUSPICIOUS:${elapsedMs}`);
      }

      return {
        transcript,
        model,
        model_ms: elapsedMs,
      };
    } finally {
      clearTimeout(timeout);
    }
  })();

  return { model, controller, promise };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const startedAt = performance.now();

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return json(503, { error: "VOICE_NOT_CONFIGURED" });
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json(400, { error: "AUDIO_REQUIRED" });
    }

    if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
      return json(400, { error: "INVALID_AUDIO_SIZE" });
    }

    const mimeType = String(file.type || "audio/webm").split(";")[0];
    if (!mimeType.startsWith("audio/")) {
      return json(415, { error: "AUDIO_REQUIRED" });
    }

    const audioReadStartedAt = performance.now();
    const audioBase64 = bytesToBase64(
      new Uint8Array(await file.arrayBuffer()),
    );
    const audioReadMs = Math.round(performance.now() - audioReadStartedAt);

    const prompt =
      "Faça uma transcrição literal desta fala curta em português do Brasil. " +
      "Responda somente com as palavras realmente ouvidas, sem JSON, aspas, pontuação, URLs, domínio .com, explicações, correções ou palavras relacionadas. " +
      "Se ouvir uma palavra, devolva uma palavra; se ouvir duas ou três, devolva apenas essas. " +
      "Não complete, não associe produtos e não invente termos. Se não houver fala inteligível, responda vazio.";

    const primaryAttempt = createModelAttempt(
      PRIMARY_MODEL,
      PRIMARY_TIMEOUT_MS,
      apiKey,
      prompt,
      mimeType,
      audioBase64,
    );

    let fallbackAttempt:
      | ReturnType<typeof createModelAttempt>
      | null = null;
    let fallbackTimer: number | null = null;

    const fallbackPromise = new Promise<{
      transcript: string;
      model: string;
      model_ms: number;
    }>((resolve, reject) => {
      fallbackTimer = setTimeout(() => {
        fallbackAttempt = createModelAttempt(
          FALLBACK_MODEL,
          FALLBACK_TIMEOUT_MS,
          apiKey,
          prompt,
          mimeType,
          audioBase64,
        );
        fallbackAttempt.promise.then(resolve, reject);
      }, FALLBACK_DELAY_MS);
    });

    let winner: {
      transcript: string;
      model: string;
      model_ms: number;
    };

    try {
      winner = await Promise.any([
        primaryAttempt.promise,
        fallbackPromise,
      ]);
    } catch (error) {
      const totalMs = Math.round(performance.now() - startedAt);
      const errors =
        error instanceof AggregateError
          ? error.errors.map((item) =>
              item instanceof Error ? item.message : String(item)
            )
          : [error instanceof Error ? error.message : String(error)];

      console.log(
        JSON.stringify({
          event: "beta_voice_transcription_failed",
          total_ms: totalMs,
          errors,
        }),
      );

      return json(504, {
        error: "VOICE_TRANSCRIPTION_TIMEOUT",
        attempted_models: [PRIMARY_MODEL, FALLBACK_MODEL],
        timing: {
          audio_read_ms: audioReadMs,
          total_ms: totalMs,
        },
      });
    } finally {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
    }

    if (winner.model !== PRIMARY_MODEL) {
      primaryAttempt.controller.abort();
    }
    if (fallbackAttempt && winner.model !== FALLBACK_MODEL) {
      fallbackAttempt.controller.abort();
    }

    const totalMs = Math.round(performance.now() - startedAt);

    if (isSuspiciousTranscript(winner.transcript)) {
      console.log(
        JSON.stringify({
          event: "beta_voice_transcription_rejected",
          transcript: winner.transcript,
          model: winner.model,
          model_ms: winner.model_ms,
          total_ms: totalMs,
          audio_bytes: file.size,
        }),
      );

      return json(200, {
        transcript: "",
        rejected_transcript: winner.transcript,
        model: winner.model,
        timing: {
          audio_read_ms: audioReadMs,
          model_ms: winner.model_ms,
          total_ms: totalMs,
        },
      });
    }

    console.log(
      JSON.stringify({
        event: "beta_voice_transcription",
        transcript: winner.transcript,
        model: winner.model,
        model_ms: winner.model_ms,
        total_ms: totalMs,
        audio_bytes: file.size,
      }),
    );

    return json(200, {
      transcript: winner.transcript,
      model: winner.model,
      timing: {
        audio_read_ms: audioReadMs,
        model_ms: winner.model_ms,
        total_ms: totalMs,
      },
    });
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);

    console.log(
      JSON.stringify({
        event: "beta_voice_transcription_error",
        total_ms: totalMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return json(500, {
      error: "VOICE_TRANSCRIPTION_FAILED",
      timing: {
        total_ms: totalMs,
      },
    });
  }
});
