import { createRoot } from "react-dom/client";
import App from "./App.tsx";
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

createRoot(document.getElementById("root")!).render(<App />);
