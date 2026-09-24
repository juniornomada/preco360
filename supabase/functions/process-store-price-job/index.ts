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

function transientReason(message: unknown) {
  const value = String(message || "").toLowerCase();
  return (
    value.includes("resource_exhausted") ||
    value.includes("quota") ||
    value.includes("429") ||
    value.includes("rate limit") ||
    value.includes("signal has been aborted") ||
    value.includes("aborted") ||
    value.includes("timeout") ||
    value.includes("timed out") ||
    value.includes("503") ||
    value.includes("502") ||
    value.includes("504") ||
    value.includes("temporarily unavailable") ||
    value.includes("overloaded")
  );
}

function retryDelayMs(message: unknown, attempts: number) {
  const raw = String(message || "");
  const explicit =
    raw.match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i) ||
    raw.match(/retry after\s+([0-9]+(?:\.[0-9]+)?)\s*seconds?/i);

  if (explicit) {
    const seconds = Math.ceil(Number(explicit[1]) || 0);
    return Math.min(90_000, Math.max(8_000, (seconds + 3) * 1000));
  }

  const backoff = [12_000, 25_000, 45_000, 60_000, 90_000];
  return backoff[Math.min(Math.max(0, attempts - 1), backoff.length - 1)];
}

function retryMap(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, any>;
  }
  return { ...(value as Record<string, any>) };
}

async function waitAndTrigger(jobId: string, delayMs: number) {
  const bounded = Math.min(60_000, Math.max(1_000, delayMs));
  await new Promise((resolve) => setTimeout(resolve, bounded));
  await triggerNext(jobId);
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

  throw new Error(
    String(
      payload?.message ||
        payload?.error ||
        `Falha HTTP ${response.status} ao analisar a foto.`,
    ),
  );
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

    // Older versions mistakenly promoted transient infrastructure failures
    // (429/quota/timeouts) to final failures. Re-open them automatically.
    const rawFailures = asArray(job.result?.failures) as any[];
    const previousFailures = rawFailures.filter(
      (item) => !transientReason(item?.reason),
    );
    const retries = retryMap(job.result?.retries);

    for (const item of rawFailures) {
      if (!transientReason(item?.reason)) continue;
      const key = String(Number(item.index));
      const existing = retries[key] || {};
      retries[key] = {
        attempts: Number(existing.attempts) || 0,
        last_error: String(item.reason || ""),
        next_retry_at: existing.next_retry_at || null,
      };
    }

    const processed = new Set<number>([
      ...previousObservations.map((item) => Number(item.index)),
      ...previousFailures.map((item) => Number(item.index)),
    ]);

    const nowMs = Date.now();
    const pending = sources.filter((source) => {
      if (processed.has(source.index)) return false;
      const retry = retries[String(source.index)];
      if (!retry?.next_retry_at) return true;
      const retryAt = new Date(retry.next_retry_at).getTime();
      return !Number.isFinite(retryAt) || retryAt <= nowMs;
    });

    const deferred = sources.filter((source) => {
      if (processed.has(source.index)) return false;
      const retry = retries[String(source.index)];
      if (!retry?.next_retry_at) return false;
      const retryAt = new Date(retry.next_retry_at).getTime();
      return Number.isFinite(retryAt) && retryAt > nowMs;
    });
    if (!pending.length) {
      if (deferred.length) {
        const nextRetryMs = Math.min(
          ...deferred.map((source) => {
            const retryAt = new Date(
              retries[String(source.index)]?.next_retry_at || "",
            ).getTime();
            return Number.isFinite(retryAt) ? retryAt : nowMs + 10_000;
          }),
        );
        const waitMs = Math.max(1_000, nextRetryMs - nowMs);

        await updateJob(jobId, {
          status: "queued",
          progress_current:
            previousObservations.length + previousFailures.length,
          progress_total: sources.length,
          progress_label:
            "Aguardando a janela do Gemini para repetir " +
            deferred.length +
            " foto(s) automaticamente…",
          result: {
            ...(job.result || {}),
            observations: previousObservations,
            failures: previousFailures,
            retries,
          },
          warning_message:
            deferred.length +
            " foto(s) estão pendentes por limite temporário/timeout e serão tentadas novamente.",
          error_message: null,
          completed_at: null,
        });

        EdgeRuntime.waitUntil(waitAndTrigger(jobId, waitMs));
        return;
      }

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
          retries,
        },
        warning_message: previousFailures.length
          ? previousFailures.length + " foto(s) ficaram sem leitura confiável."
          : null,
        error_message: null,
        completed_at: new Date().toISOString(),
      });
      return;
    }

    const source = pending[0];
    const alreadyDone = sources.length - pending.length;

    await updateJob(jobId, {
      status: "processing",
      progress_current: alreadyDone,
      progress_total: sources.length,
      progress_label:
        "Analisando foto " +
        source.index +
        " de " +
        sources.length +
        " no servidor…",
      error_message: null,
      completed_at: null,
    });

    let newObservation: any | null = null;
    let newFailure: any | null = null;
    let transientError: string | null = null;

    try {
      const payload = await analyzeSource(source);

      if (payload?.observation) {
        newObservation = {
          index: source.index,
          source_file_name: source.name,
          source_image_path: source.path,
          source_hash: source.hash || null,
          observation: payload.observation,
          model: payload.model || null,
        };
        delete retries[String(source.index)];
      } else {
        newFailure = {
          index: source.index,
          source_file_name: source.name,
          source_image_path: source.path,
          source_hash: source.hash || null,
          reason:
            payload?.message ||
            payload?.reason ||
            "Não foi possível relacionar produto e preço com segurança.",
        };
        delete retries[String(source.index)];
      }
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : String(error ?? "Falha inesperada.");

      if (transientReason(reason)) {
        transientError = reason;
        const key = String(source.index);
        const priorAttempts = Number(retries[key]?.attempts) || 0;
        const attempts = priorAttempts + 1;
        const delayMs = retryDelayMs(reason, attempts);

        retries[key] = {
          attempts,
          last_error: reason,
          next_retry_at: new Date(Date.now() + delayMs).toISOString(),
        };
      } else {
        newFailure = {
          index: source.index,
          source_file_name: source.name,
          source_image_path: source.path,
          source_hash: source.hash || null,
          reason,
        };
        delete retries[String(source.index)];
      }
    }

    const observations = newObservation
      ? mergeByIndex(previousObservations, [newObservation])
      : previousObservations;
    const failures = newFailure
      ? mergeByIndex(previousFailures, [newFailure])
      : previousFailures;
    const done = observations.length + failures.length;

    const result = {
      ...(job.result || {}),
      observations,
      failures,
      retries,
    };

    if (done >= sources.length && !Object.keys(retries).length) {
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

    const retryCount = Object.keys(retries).length;
    await updateJob(jobId, {
      status: transientError ? "queued" : "processing",
      progress_current: done,
      progress_total: sources.length,
      progress_label: transientError
        ? done +
          "/" +
          sources.length +
          " concluída(s); foto " +
          source.index +
          " aguardando retry automático."
        : done +
          "/" +
          sources.length +
          " foto(s) processada(s). Continuando no servidor…",
      result,
      warning_message: retryCount
        ? retryCount +
          " foto(s) aguardando retry automático por limite temporário/timeout."
        : failures.length
          ? failures.length + " foto(s) ficaram sem leitura confiável até agora."
          : null,
      error_message: null,
      completed_at: null,
    });

    // Always continue server-to-server. If the current image hit a transient
    // limit, the next invocation will process another eligible photo first;
    // when only deferred retries remain, it waits for the provider window.
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
