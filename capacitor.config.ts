import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Experimental Android package. Deliberately bundles local web assets,
 * never loading remote arbitrary JavaScript with a native HTTP bridge.
 * The regular browser app remains unchanged until this pilot is verified.
 */
const config: CapacitorConfig = {
  appId: "com.juniornomada.preco360.pilot",
  appName: "Preco 360 QR - Teste",
  webDir: "dist",
  loggingBehavior: "none",
  plugins: {
    CapacitorHttp: { enabled: false },
  },
};

export default config;
