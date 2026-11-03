/**
 * A new Supabase Edge Function invocation can use a different outgoing
 * connection to SEFAZ-SP. In real captures on 03/11/2026, three fast retries
 * inside one invocation all failed with ECONNRESET; scanning the very same
 * QR again, 7–16 seconds later, succeeded.
 *
 * Recreate that second invocation automatically without reopening the camera.
 * Never retry CAPTCHA, portal denials, HTTP errors or parser failures.
 */
const RETRY_DELAYS_MS = [3500, 6500] as const;

export type FiscalQrResponse<T extends { code?: string } = { code?: string }> = {
  data: T | null;
  error: unknown;
};

export async function retryQrTransportFailure<T extends { code?: string }>(
  invoke: () => Promise<FiscalQrResponse<T>>,
  options: {
    wait?: (milliseconds: number) => Promise<void>;
    onRetry?: (retryNumber: number, totalRetries: number) => void;
  } = {},
): Promise<FiscalQrResponse<T>> {
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  let result = await invoke();

  for (let i = 0; i < RETRY_DELAYS_MS.length; i += 1) {
    // Only the structured upstream network reset qualifies. Server responses
    // that require a human action must never be retried automatically.
    if (result.error || result.data?.code !== "UPSTREAM_NETWORK") break;
    options.onRetry?.(i + 1, RETRY_DELAYS_MS.length);
    await wait(RETRY_DELAYS_MS[i]);
    result = await invoke();
  }

  return result;
}
