import { createRoot } from "react-dom/client";
import "./index.css";

const CHUNK_RELOAD_KEY = "preco360:chunk-reload-at";
const CHUNK_RELOAD_COOLDOWN = 60_000;

function isChunkLoadError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|expected a javascript-or-wasm module script/i.test(message);
}

function refreshForNewDeployment() {
  const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
  if (Date.now() - lastReload < CHUNK_RELOAD_COOLDOWN) return;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

// Quando uma nova versão entra no ar enquanto o usuário ainda está com a versão
// anterior aberta, os chunks com hash antigo deixam de existir no domínio atual.
// O Vite dispara este evento antes de rejeitar o import dinâmico; recarregamos uma
// vez para baixar o HTML e os chunks da versão nova sem obrigar o usuário a agir.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  refreshForNewDeployment();
});

// Fallback para navegadores que não propagam vite:preloadError.
window.addEventListener("unhandledrejection", (event) => {
  if (!isChunkLoadError(event.reason)) return;
  event.preventDefault();
  refreshForNewDeployment();
});

const root = createRoot(document.getElementById("root")!);

function showStartupError(reason: string) {
  console.error("[Preço 360 Preview] Falha na inicialização:", reason);
  root.render(
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 560, margin: "48px auto", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 22 }}>Não foi possível iniciar o Preço 360</h1>
      <p>O aplicativo não conseguiu carregar. A produção não foi alterada.</p>
      <p style={{ overflowWrap: "anywhere" }}><strong>Diagnóstico:</strong> {reason}</p>
      <button onClick={() => window.location.reload()} style={{ padding: "12px 20px", borderRadius: 8, cursor: "pointer" }}>
        Tentar novamente
      </button>
    </div>
  );
}

async function bootstrap() {
  const missing = [
    !import.meta.env.VITE_SUPABASE_URL && "VITE_SUPABASE_URL",
    !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY && "VITE_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);

  if (missing.length) {
    showStartupError("Variáveis ausentes no build: " + missing.join(", "));
    return;
  }

  try {
    const { default: App } = await import("./App.tsx");
    root.render(<App />);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showStartupError("Falha ao carregar a aplicação: " + message);
  }
}

void bootstrap();
