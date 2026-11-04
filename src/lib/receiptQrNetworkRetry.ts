/**
 * A new Supabase Edge Function invocation can use a different outgoing
 * connection to SEFAZ-SP. In real captures on 03/11/2026, three fast retries
 * inside one invocation all failed with ECONNRESET; scanning the very same
 * QR again, 7–16 seconds later, succeeded. Other QR attempts on 04/11
 * required up to six independent calls before a fast successful response.
 * The fiscal Edge Function now supports an opt-in single-attempt mode for
 * official SP QRs; bounded fresh invocations replace redundant nested waits.
 *
 * Recreate that second invocation automatically without reopening the camera.
 * Never retry CAPTCHA, portal denials, HTTP errors or parser failures.
 */
const RETRY_DELAYS_MS = [1200, 1800, 2500, 3500, 4500] as const;

export type FiscalQrResponse<T extends { code?: string } = { code?: string }> = {
  data: T | null;
  error: unknown;
};

export async function retryQrTransportFailure<T extends { code?: string }>(
  invoke: () => Promise<FiscalQrResponse<T>>,
  options: {
    wait?: (milliseconds: number) => Promise<void>;
    onRetry?: (retryNumber: number, totalRetries: number) => void;
    retryDelaysMs?: readonly number[];
  } = {},
): Promise<FiscalQrResponse<T>> {
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const retryDelays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  let result = await invoke();

  for (let i = 0; i < retryDelays.length; i += 1) {
    // Only the structured upstream network reset qualifies. Server responses
    // that require a human action must never be retried automatically.
    if (result.error || result.data?.code !== "UPSTREAM_NETWORK") break;
    options.onRetry?.(i + 1, retryDelays.length);
    await wait(retryDelays[i]);
    result = await invoke();
  }

  return result;
}
