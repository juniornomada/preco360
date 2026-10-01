import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedEvents = new Set(["start", "result", "error", "end_no_text"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const event = String(body?.event ?? "");
    if (!allowedEvents.has(event)) {
      return new Response(JSON.stringify({ error: "invalid_event" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const alternatives = Array.isArray(body?.alternatives)
      ? body.alternatives.slice(0, 5).map((value: unknown) => String(value ?? "").slice(0, 120))
      : [];

    const payload = {
      event: "beta_native_voice",
      native_event: event,
      session_id: String(body?.session_id ?? "").slice(0, 80),
      alternatives,
      normalized: String(body?.normalized ?? "").slice(0, 120),
      is_final: Boolean(body?.is_final),
      speech_started: Boolean(body?.speech_started),
      error: String(body?.error ?? "").slice(0, 80),
      elapsed_ms: Math.max(0, Math.min(30000, Number(body?.elapsed_ms) || 0)),
      phrase_bias_supported: Boolean(body?.phrase_bias_supported),
    };

    console.log(JSON.stringify(payload));
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "beta_native_voice_log_error", error: error instanceof Error ? error.message : String(error) }));
    return new Response(JSON.stringify({ error: "invalid_payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
