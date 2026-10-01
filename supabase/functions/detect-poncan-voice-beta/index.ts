import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
] as const;

const MODEL_TIMEOUT_MS = 3400;

const PONCAN_ALIASES = new Set([
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

function normalize(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function createAttempt(
  model: string,
  apiKey: string,
  mimeType: string,
  audioBase64: string,
) {
  const controller = new AbortController();

  const promise = (async () => {
    const startedAt = performance.now();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

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
                      "Transcreva literalmente esta fala curta em português do Brasil. " +
                      "Responda somente com a palavra ou expressão falada, sem explicações, sem JSON e sem pontuação. " +
                      "Não corrija e não complete a fala.",
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
              maxOutputTokens: 12,
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

      const raw = extractText(payload);
      const key = normalize(raw);

      if (!key) {
        throw new Error(`${model}:EMPTY:${elapsedMs}`);
      }

      return {
        raw,
        key,
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

    const attempts = MODELS.map((model) =>
      createAttempt(model, apiKey, mimeType, audioBase64)
    );

    let winner: {
      raw: string;
      key: string;
      model: string;
      model_ms: number;
    };

    try {
      winner = await Promise.any(attempts.map((attempt) => attempt.promise));
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
          event: "beta_poncan_detection_failed",
          total_ms: totalMs,
          errors,
        }),
      );

      return json(504, {
        error: "PONCAN_DETECTION_FAILED",
        timing: { total_ms: totalMs },
      });
    }

    for (const attempt of attempts) {
      if (attempt.model !== winner.model) {
        attempt.controller.abort();
      }
    }

    const totalMs = Math.round(performance.now() - startedAt);

    const isPoncan = PONCAN_ALIASES.has(winner.key);

    console.log(
      JSON.stringify({
        event: "beta_poncan_detection",
        raw: winner.raw,
        normalized: winner.key,
        is_poncan: isPoncan,
        model: winner.model,
        model_ms: winner.model_ms,
        total_ms: totalMs,
        audio_bytes: file.size,
      }),
    );

    return json(200, {
      is_poncan: isPoncan,
      heard: winner.raw,
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
        event: "beta_poncan_detection_error",
        total_ms: totalMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return json(500, {
      error: "PONCAN_DETECTION_FAILED",
      timing: { total_ms: totalMs },
    });
  }
});
