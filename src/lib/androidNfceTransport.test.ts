import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkDigit } from "@/lib/nfceKey";

const native = vi.hoisted(() => ({
  running: false,
  platform: "web",
  get: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => native.running,
    getPlatform: () => native.platform,
  },
  CapacitorHttp: { get: native.get },
}));

import {
  fetchOfficialNfceOnAndroid,
  hasAndroidNativeReceiptTransport,
  isOfficialSpNfceForNativeFetch,
} from "./androidNfceTransport";

const first43 = "3526111234567800019065" + "1".repeat(21);
const key = first43 + String(checkDigit(first43));
const official = "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx?p=" +
  key + "|2|1|1|" + "a".repeat(40);

const fakeHtml = "<html><body>" + "DOCUMENTO AUXILIAR NFC-e ".repeat(8) + "</body></html>";

beforeEach(() => {
  native.running = false;
  native.platform = "web";
  native.get.mockReset();
});

describe("Native NFC-e transport availability", () => {
  it("never runs serverless-native HTTP from a Chrome web page", async () => {
    expect(hasAndroidNativeReceiptTransport()).toBe(false);
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
    expect(native.get).not.toHaveBeenCalled();
  });

  it("rejects Android-emulated web and only enables Android native runtime", () => {
    native.running = true;
    native.platform = "ios";
    expect(hasAndroidNativeReceiptTransport()).toBe(false);
    native.platform = "android";
    expect(hasAndroidNativeReceiptTransport()).toBe(true);
  });

  it("validates official SP QR links including fiscal check digit", () => {
    expect(key).toHaveLength(44);
    expect(isOfficialSpNfceForNativeFetch(official)).toBe(true);
    expect(isOfficialSpNfceForNativeFetch("https://example.com/private")).toBe(false);
    expect(isOfficialSpNfceForNativeFetch(official.replace("https:", "http:"))).toBe(false);
    expect(isOfficialSpNfceForNativeFetch(official.replace(".gov.br/", ".gov.br.evil.example/"))).toBe(false);
    expect(isOfficialSpNfceForNativeFetch(official + "&url=https://evil.example")).toBe(false);
    expect(isOfficialSpNfceForNativeFetch(official.replace(key, key.slice(0, 43) + ((Number(key[43]) + 1) % 10)))).toBe(false);
  });

  it("reads actual HTML through the native Android HTTPS bridge", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockResolvedValue({
      status: 200, data: fakeHtml, headers: {}, url: official,
    });
    expect(await fetchOfficialNfceOnAndroid(official)).toBe(fakeHtml);
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get.mock.calls[0][0].disableRedirects).toBe(true);
    expect(native.get.mock.calls[0][0].url).toBe(official);
  });

  it("does not follow an off-domain redirect", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockResolvedValue({
      status: 302,
      data: "",
      headers: { Location: "https://evil.example/collect" },
      url: official,
    });
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
    expect(native.get).toHaveBeenCalledOnce();
  });

  it("follows an official same-origin redirect at most twice", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockResolvedValueOnce({
      status: 302,
      headers: { location: "/NFCeConsultaPublica/resultado.aspx" },
      data: "",
    }).mockResolvedValueOnce({
      status: 200, headers: {}, data: fakeHtml,
    });
    expect(await fetchOfficialNfceOnAndroid(official)).toBe(fakeHtml);
    expect(native.get).toHaveBeenCalledTimes(2);
  });

  it("does not bypass blocked or rejected fiscal access", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockResolvedValueOnce({status: 403, data: "Forbidden", headers: {}})
      .mockResolvedValueOnce({
        status: 200, data: "<html>" + "Request Rejected ".repeat(20) + "</html>", headers: {},
      });
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
  });

  it("handles native TLS and connection errors without masking the existing QR fallback", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockRejectedValue(new Error("SSLHandshakeException"));
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
  });

  it("caps returned HTML to avoid large native memory transfer", async () => {
    native.running = true;
    native.platform = "android";
    native.get.mockResolvedValue({
      status: 200, data: "x".repeat(1_500_001), headers: {},
    });
    expect(await fetchOfficialNfceOnAndroid(official)).toBeNull();
  });
});
