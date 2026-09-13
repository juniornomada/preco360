export interface ImportAttempt {
  traceId?: string;
  at: string;
  source: "url" | "key" | "file";
  status: "success" | "error";
  step?: string;
  code?: string;
  message?: string;
  durationMs?: number;
  itemCount?: number;
  supermarket?: string;
  markers?: string[];
  htmlLength?: number | null;
  wasRedirected?: boolean | null;
  /** URL solicitada (mascarada) */
  requestedUrl?: string;
  /** URL final após redirecionamentos da SEFAZ */
  finalUrl?: string;
  /** Evento de bloqueio da SEFAZ (CAPTCHA / redirecionamento / JS obrigatório) */
  blockType?: "captcha" | "redirect" | "js_required" | "other";
}


const KEY = "import-attempts";
const MAX = 20;

export function getAttempts(): ImportAttempt[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addAttempt(attempt: ImportAttempt): ImportAttempt[] {
  const next = [attempt, ...getAttempts()].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage cheio — ignora
  }
  window.dispatchEvent(new CustomEvent("import-attempts-changed"));
  return next;
}

export function clearAttempts() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent("import-attempts-changed"));
}
