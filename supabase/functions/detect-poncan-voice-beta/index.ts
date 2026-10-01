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
const PRIMARY_TIMEOUT_MS = 2600;
const FALLBACK_TIMEOUT_MS = 2200;
const FALLBACK_DELAY_MS = 550;

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
  )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function createAttempt(
  model: string,
  timeoutMs: number,
  apiKey: string,
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
                  {
                    text:
                      "Classifique somente se esta fala corresponde ao nome da fruta poncã, " +
                      "incluindo pronúncias equivalentes como poncan, ponkan, pocan ou ponca. " +
                      "Responda exatamente PONCAN se corresponder. Caso contrário responda exatamente NAO. " +
                      "Não transcreva outras palavras e não explique.",
                  },
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
              maxOutputTokens: 4,
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

      const answer = extractText(payload);
      if (answer !== "poncan" && answer !== "nao") {
        throw new Error(`${model}:INVALID:${answer}:${elapsedMs}`);
      }

      return {
        isPoncan: answer === "poncan",
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
    if (!apiKey) return json(503, { error: "VOICE_NOT_CONFIGURED" });

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

    const audioBase64 = bytesToBase64(
      new Uint8Array(await file.arrayBuffer()),
    );

    const primary = createAttempt(
      PRIMARY_MODEL,
      PRIMARY_TIMEOUT_MS,
      apiKey,
      mimeType,
      audioBase64,
    );

    let fallback: ReturnType<typeof createAttempt> | null = null;
    let fallbackTimer: number | null = null;

    const fallbackPromise = new Promise<{
      isPoncan: boolean;
      model: string;
      model_ms: number;
    }>((resolve, reject) => {
      fallbackTimer = setTimeout(() => {
        fallback = createAttempt(
          FALLBACK_MODEL,
          FALLBACK_TIMEOUT_MS,
          apiKey,
          mimeType,
          audioBase64,
        );
        fallback.promise.then(resolve, reject);
      }, FALLBACK_DELAY_MS);
    });

    let winner: {
      isPoncan: boolean;
      model: string;
      model_ms: number;
    };

    try {
      winner = await Promise.any([primary.promise, fallbackPromise]);
    } finally {
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
    }

    if (winner.model !== PRIMARY_MODEL) primary.controller.abort();
    if (fallback && winner.model !== FALLBACK_MODEL) fallback.controller.abort();

    const totalMs = Math.round(performance.now() - startedAt);

    console.log(
      JSON.stringify({
        event: "beta_poncan_detection",
        is_poncan: winner.isPoncan,
        model: winner.model,
        model_ms: winner.model_ms,
        total_ms: totalMs,
        audio_bytes: file.size,
      }),
    );

    return json(200, {
      is_poncan: winner.isPoncan,
      model: winner.model,
      timing: {
        model_ms: winner.model_ms,
        total_ms: totalMs,
      },
    });
  } catch (error) {
    const totalMs = Math.round(performance.now() - startedAt);

    console.log(
      JSON.stringify({
        event: "beta_poncan_detection_failed",
        total_ms: totalMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return json(504, {
      error: "PONCAN_DETECTION_FAILED",
      timing: { total_ms: totalMs },
    });
  }
});
