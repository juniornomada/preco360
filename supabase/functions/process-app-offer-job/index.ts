import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SourceFile = {
  index: number;
  path: string;
  name: string;
  mime_type?: string | null;
  size?: number | null;
  hash?: string | null;
};

type JobRow = {
  id: string;
  user_id: string;
  retailer: string;
  status: string;
  progress_current: number;
  progress_total: number;
  progress_label: string;
  source_files: SourceFile[];
  result: any;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Credenciais do Supabase indisponíveis.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function callerIdentity(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (token && serviceKey && token === serviceKey) {
    return { isService: true, userId: null as string | null };
  }
  if (!token) return { isService: false, userId: null as string | null };

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return { isService: false, userId: null as string | null };

  const authClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return { isService: false, userId: null as string | null };
  return { isService: false, userId: data.user.id };
}

async function fetchJob(jobId: string) {
  const { data, error } = await serviceClient()
    .from("app_offer_import_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return data as JobRow;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const { error } = await serviceClient()
    .from("app_offer_import_jobs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

async function downloadSource(source: SourceFile) {
  const { data, error } = await serviceClient().storage
    .from("flyers")
    .download(source.path);
  if (error || !data) throw error || new Error("Print não encontrado.");
  return new File([data], source.name || `app-${source.index}.jpg`, {
    type: source.mime_type || data.type || "image/jpeg",
  });
}

async function analyzeSource(source: SourceFile) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Servidor de análise indisponível.");

  const file = await downloadSource(source);
  const body = new FormData();
  body.append("file", file, source.name || `app-${source.index}.jpg`);

  const response = await fetch(url + "/functions/v1/analyze-app-offer", {
    method: "POST",
    headers: { Authorization: "Bearer " + key },
    body,
  });

  const payload = await response
    .json()
    .catch(async () => ({ message: await response.text().catch(() => "") }));

  if (!response.ok) {
    throw new Error(
      String(payload?.message || payload?.error || `Falha HTTP ${response.status}`),
    );
  }

  return payload;
}

async function triggerNext(jobId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Não foi possível continuar a análise.");

  await fetch(url + "/functions/v1/process-app-offer-job", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  });
}

async function processBatch(jobId: string) {
  try {
    const job = await fetchJob(jobId);
    if (job.status === "completed") return;

    const sources = asArray(job.source_files)
      .map((source: any, position: number) => ({
        index: Math.max(1, Math.trunc(Number(source?.index) || position + 1)),
        path: String(source?.path || ""),
        name: String(source?.name || `app-${position + 1}.jpg`),
        mime_type: source?.mime_type ? String(source.mime_type) : null,
        size: Number(source?.size) || null,
        hash: source?.hash ? String(source.hash) : null,
      }))
      .filter((source) => source.path)
      .sort((a, b) => a.index - b.index);

    if (!sources.length) throw new Error("O job não possui capturas para analisar.");

    const processedFiles = asArray(job.result?.files) as any[];
    const processedIndexes = new Set(processedFiles.map((item) => Number(item.index)));
    const source = sources.find((item) => !processedIndexes.has(item.index));

    if (!source) {
      const offers = processedFiles.flatMap((item) =>
        Array.isArray(item?.offers)
          ? item.offers.map((offer: any) => ({
              ...offer,
              source_index: item.index,
              source_file_name: item.source_file_name,
              source_image_path: item.source_image_path,
              source_hash: item.source_hash,
            }))
          : [],
      );
      const failures = processedFiles.filter((item) => item?.error);

      await updateJob(jobId, {
        status: "completed",
        progress_current: sources.length,
        progress_total: sources.length,
        progress_label:
          `${offers.length} oferta(s) identificada(s) em ${sources.length} print(s).`,
        result: { files: processedFiles, offers },
        warning_message: failures.length
          ? `${failures.length} print(s) ficaram sem leitura confiável.`
          : null,
        error_message: null,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    await updateJob(jobId, {
      status: "processing",
      progress_current: processedFiles.length,
      progress_total: sources.length,
      progress_label: `Analisando print ${source.index} de ${sources.length} no servidor…`,
      error_message: null,
      completed_at: null,
    });

    let fileResult: any;
    try {
      const payload = await analyzeSource(source);
      fileResult = {
        index: source.index,
        source_file_name: source.name,
        source_image_path: source.path,
        source_hash: source.hash || null,
        offers: Array.isArray(payload?.offers) ? payload.offers : [],
        model: payload?.model || null,
        error: null,
      };
    } catch (error) {
      fileResult = {
        index: source.index,
        source_file_name: source.name,
        source_image_path: source.path,
        source_hash: source.hash || null,
        offers: [],
        model: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const nextFiles = [...processedFiles, fileResult]
      .sort((a, b) => Number(a.index) - Number(b.index));

    await updateJob(jobId, {
      status: "processing",
      progress_current: nextFiles.length,
      progress_total: sources.length,
      progress_label: `${nextFiles.length}/${sources.length} print(s) processado(s). Continuando no servidor…`,
      result: { ...(job.result || {}), files: nextFiles },
      warning_message: nextFiles.some((item) => item?.error)
        ? "Alguns prints ainda podem precisar de revisão manual."
        : null,
      error_message: null,
      completed_at: null,
    });

    await triggerNext(jobId);
  } catch (error) {
    console.error("process-app-offer-job", error);
    await updateJob(jobId, {
      status: "failed",
      progress_label: "A análise foi interrompida, mas os prints enviados foram preservados.",
      error_message: error instanceof Error ? error.message : "Falha inesperada.",
      completed_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  try {
    const body = await req.json();
    const jobId = String(body?.job_id || "").trim();
    if (!jobId) return json(400, { error: "JOB_ID_REQUIRED" });

    const caller = await callerIdentity(req);
    const job = await fetchJob(jobId);
    const isOwner = !!caller.userId && caller.userId === job.user_id;

    if (!caller.isService && !isOwner) return json(403, { error: "FORBIDDEN" });

    if (job.status === "completed") {
      return json(200, { ok: true, job_id: jobId, status: "completed" });
    }

    EdgeRuntime.waitUntil(processBatch(jobId));
    return json(202, {
      ok: true,
      job_id: jobId,
      status: "processing",
      progress_current: Number(job.progress_current) || 0,
      progress_total: Number(job.progress_total) || 0,
    });
  } catch (error) {
    return json(500, {
      error: "JOB_START_FAILED",
      message: error instanceof Error ? error.message : "Falha ao iniciar análise.",
    });
  }
});
