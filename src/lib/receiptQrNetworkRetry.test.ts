import { describe, expect, it, vi } from "vitest";
import { retryQrTransportFailure } from "./receiptQrNetworkRetry";

const reset = () => ({
  data: { code: "UPSTREAM_NETWORK", error: "Connection reset by peer" },
  error: null,
});
const success = () => ({
  data: { items: [{ name: "Produto", price: 12.5 }], supermarket: "Tauste" },
  error: null,
});

describe("fresh Edge Function invocation after a scanned NFC-e QR", () => {
  it("reuses the captured QR without scanning again when the second invocation succeeds", async () => {
    const invoke = vi.fn().mockResolvedValueOnce(reset()).mockResolvedValueOnce(success());
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    const result = await retryQrTransportFailure(invoke, { wait, onRetry });

    expect(result).toEqual(success());
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(3500);
    expect(onRetry).toHaveBeenCalledWith(1, 2);
  });

  it("allows at most two additional server invocations for persistent reset", async () => {
    const invoke = vi.fn().mockResolvedValue(reset());
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    const result = await retryQrTransportFailure(invoke, { wait, onRetry });
    expect(result.data?.code).toBe("UPSTREAM_NETWORK");
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[3500], [6500]]);
    expect(onRetry.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("succeeds on the third try without showing the earlier transient failure", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(success());
    const result = await retryQrTransportFailure(invoke, {
      wait: async () => undefined,
    });
    expect(result).toEqual(success());
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it.each(["PORTAL_REJECTED", "CAPTCHA_REQUIRED", "BLOCKED", "HTTP_ERROR", "NO_ITEMS", "QR_FORMAT"])(
    "does not repeat denied or non-transport error %s",
    async (code) => {
      const initial = { data: { code, error: "Consulta não concluída" }, error: null };
      const invoke = vi.fn().mockResolvedValue(initial);
      const wait = vi.fn();
      expect(await retryQrTransportFailure(invoke, { wait })).toBe(initial);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it("does not retry a successful receipt response", async () => {
    const invoke = vi.fn().mockResolvedValue(success());
    const wait = vi.fn();
    expect(await retryQrTransportFailure(invoke, { wait })).toEqual(success());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("preserves actual Edge invocation errors", async () => {
    const error = new Error("Edge Function request failed");
    const invoke = vi.fn().mockResolvedValue({ data: null, error });
    const wait = vi.fn();
    expect((await retryQrTransportFailure(invoke, { wait })).error).toBe(error);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("propagates a thrown transport exception rather than retrying indiscriminately", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("unexpected client error"));
    await expect(retryQrTransportFailure(invoke)).rejects.toThrow("unexpected client error");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
