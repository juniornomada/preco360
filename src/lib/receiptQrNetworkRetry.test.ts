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
    expect(wait).toHaveBeenCalledWith(1200);
    expect(onRetry).toHaveBeenCalledWith(1, 5);
  });

  it("allows at most five additional fresh invocations, fewer than the old nine nested requests", async () => {
    const invoke = vi.fn().mockResolvedValue(reset());
    const wait = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();
    const result = await retryQrTransportFailure(invoke, { wait, onRetry });
    expect(result.data?.code).toBe("UPSTREAM_NETWORK");
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(wait.mock.calls).toEqual([[1200], [1800], [2500], [3500], [4500]]);
    expect(onRetry.mock.calls).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
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

  it("still succeeds without a second scan when the sixth fresh invocation works", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(reset())
      .mockResolvedValueOnce(success());
    const wait = vi.fn().mockResolvedValue(undefined);
    const result = await retryQrTransportFailure(invoke, { wait });
    expect(result).toEqual(success());
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(wait).toHaveBeenCalledTimes(5);
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
