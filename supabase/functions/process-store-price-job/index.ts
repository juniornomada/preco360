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
  observed_date: string;
  status: string;
  progress_current: number;
  progress_total: number;
  progress_label: string;
  source_files: SourceFile[];
  result: any;
  warning_message: string | null;
  error_message: string | null;
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
  if (!url || !key) throw new Error("Supabase service credentials unavailable.");
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
    .from("store_price_analysis_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error) throw error;
  return data as JobRow;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const { error } = await serviceClient()
    .from("store_price_analysis_jobs")
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
  if (error || !data) {
    throw error || new Error("Foto não encontrada no armazenamento.");
  }

  return new File([data], source.name || `foto-${source.index}.jpg`, {
    type: source.mime_type || data.type || "image/jpeg",
  });
}

async function analyzeSource(source: SourceFile) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Servidor de análise indisponível.");

  let lastError = "Falha ao analisar a foto.";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const file = await downloadSource(source);
    const body = new FormData();
    body.append("file", file, source.name || `foto-${source.index}.jpg`);
    body.append("analysis_session_id", "server-job");
    body.append("file_index", String(source.index));
    body.append("file_total", "0");

    const response = await fetch(url + "/functions/v1/analyze-store-price", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
      },
      body,
    });

    const payload = await response
      .json()
      .catch(async () => ({ message: await response.text().catch(() => "") }));

    if (response.ok) {
      return payload;
    }

    lastError =
      payload?.message ||
      payload?.error ||
      `Falha HTTP ${response.status} ao analisar a foto.`;

    if (
      attempt < 2 &&
      (response.status === 429 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      continue;
    }

    throw new Error(String(lastError));
  }

  throw new Error(lastError);
}

async function triggerNext(jobId: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Não foi possível continuar a análise.");

  const response = await fetch(url + "/functions/v1/process-store-price-job", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  });

  if (!response.ok) {
    throw new Error(
      `Falha ao continuar análise no servidor (${response.status}).`,
    );
  }
}

function mergeByIndex<T extends { index: number }>(before: T[], added: T[]) {
  const map = new Map<number, T>();
  for (const item of before) map.set(Number(item.index), item);
  for (const item of added) map.set(Number(item.index), item);
  return [...map.values()].sort((a, b) => Number(a.index) - Number(b.index));
}

async function processBatch(jobId: string) {
  try {
    const job = await fetchJob(jobId);
    if (job.status === "completed") return;

    const sources = asArray(job.source_files)
      .map((source: any, position: number) => ({
        index: Math.max(1, Math.trunc(Number(source?.index) || position + 1)),
        path: String(source?.path || ""),
        name: String(source?.name || `foto-${position + 1}.jpg`),
        mime_type: source?.mime_type ? String(source.mime_type) : null,
        size: Number(source?.size) || null,
        hash: source?.hash ? String(source.hash) : null,
      }))
      .filter((source) => source.path)
      .sort((a, b) => a.index - b.index);

    if (!sources.length) {
      throw new Error("O job não possui fotos para analisar.");
    }

    const previousObservations = asArray(job.result?.observations) as any[];
    const previousFailures = asArray(job.result?.failures) as any[];
    const processed = new Set<number>([
      ...previousObservations.map((item) => Number(item.index)),
      ...previousFailures.map((item) => Number(item.index)),
    ]);

    const pending = sources.filter((source) => !processed.has(source.index));
    if (!pending.length) {
      await updateJob(jobId, {
        status: "completed",
        progress_current: sources.length,
        progress_total: sources.length,
        progress_label:
          previousObservations.length +
          " preço(s) identificado(s) em " +
          sources.length +
          " foto(s).",
        result: {
          ...(job.result || {}),
          observations: previousObservations,
          failures: previousFailures,
        },
        warning_message: previousFailures.length
          ? previousFailures.length + " foto(s) ficaram sem leitura confiável."
          : null,
        error_message: null,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const batch = pending.slice(0, 2);
    const alreadyDone = sources.length - pending.length;

    await updateJob(jobId, {
      status: "processing",
      progress_current: alreadyDone,
      progress_total: sources.length,
      progress_label:
        "Analisando foto" +
        (batch.length > 1 ? "s " : " ") +
        batch.map((item) => item.index).join(" e ") +
        " de " +
        sources.length +
        " no servidor…",
      error_message: null,
      completed_at: null,
    });

    const settled = await Promise.allSettled(
      batch.map(async (source) => {
        const payload = await analyzeSource(source);
        return { source, payload };
      }),
    );

    const newObservations: any[] = [];
    const newFailures: any[] = [];

    settled.forEach((entry, offset) => {
      const source = batch[offset];

      if (entry.status === "fulfilled" && entry.value.payload?.observation) {
        newObservations.push({
          index: source.index,
          source_file_name: source.name,
          source_image_path: source.path,
          source_hash: source.hash || null,
          observation: entry.value.payload.observation,
          model: entry.value.payload.model || null,
        });
        return;
      }

      if (entry.status === "fulfilled") {
        newFailures.push({
          index: source.index,
          source_file_name: source.name,
          source_image_path: source.path,
          source_hash: source.hash || null,
          reason:
            entry.value.payload?.message ||
            entry.value.payload?.reason ||
            "Não foi possível relacionar produto e preço com segurança.",
        });
        return;
      }

      newFailures.push({
        index: source.index,
        source_file_name: source.name,
        source_image_path: source.path,
        source_hash: source.hash || null,
        reason:
          entry.reason instanceof Error
            ? entry.reason.message
            : String(entry.reason ?? "Falha inesperada."),
      });
    });

    const observations = mergeByIndex(
      previousObservations,
      newObservations,
    );
    const failures = mergeByIndex(previousFailures, newFailures);
    const done = observations.length + failures.length;

    const result = {
      ...(job.result || {}),
      observations,
      failures,
    };

    if (done >= sources.length) {
      await updateJob(jobId, {
        status: "completed",
        progress_current: sources.length,
        progress_total: sources.length,
        progress_label:
          observations.length +
          " preço(s) identificado(s) em " +
          sources.length +
          " foto(s).",
        result,
        warning_message: failures.length
          ? failures.length + " foto(s) ficaram sem leitura confiável."
          : null,
        error_message: null,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    await updateJob(jobId, {
      status: "processing",
      progress_current: done,
      progress_total: sources.length,
      progress_label:
        done +
        "/" +
        sources.length +
        " foto(s) processada(s). Continuando no servidor…",
      result,
      warning_message: failures.length
        ? failures.length + " foto(s) ficaram sem leitura confiável até agora."
        : null,
      error_message: null,
      completed_at: null,
    });

    await triggerNext(jobId);
  } catch (error) {
    console.error("process-store-price-job", error);
    await updateJob(jobId, {
      status: "failed",
      progress_label:
        "A análise foi interrompida, mas as fotos enviadas e o progresso anterior foram preservados.",
      error_message:
        error instanceof Error ? error.message : "Falha inesperada na análise.",
      completed_at: new Date().toISOString(),
    }).catch(() => {});
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
    const body = await req.json();
    const jobId = String(body?.job_id || "").trim();
    if (!jobId) return json(400, { error: "JOB_ID_REQUIRED" });

    const caller = await callerIdentity(req);
    const job = await fetchJob(jobId);
    const isOwner = !!caller.userId && caller.userId === job.user_id;

    if (!caller.isService && !isOwner) {
      return json(403, { error: "FORBIDDEN" });
    }

    if (job.status === "completed") {
      return json(200, {
        ok: true,
        job_id: jobId,
        status: "completed",
      });
    }

    EdgeRuntime.waitUntil(processBatch(jobId));

    return json(202, {
      ok: true,
      job_id: jobId,
      status: "processing",
      progress_current: Number(job.progress_current) || 0,
      progress_total:
        Number(job.progress_total) ||
        (Array.isArray(job.source_files) ? job.source_files.length : 0),
    });
  } catch (error) {
    console.error("process-store-price-job handler", error);
    return json(500, {
      error: "JOB_START_FAILED",
      message:
        error instanceof Error ? error.message : "Falha ao iniciar a análise.",
    });
  }
});
