import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useAccessKeyVoice } from "./useAccessKeyVoice";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 1;
  onstart: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.onstart?.(new Event("start"));
  }

  emit(text: string) {
    this.onresult?.({
      resultIndex: 0,
      results: {
        0: { 0: { transcript: text }, length: 1, isFinal: true },
        length: 1,
      },
    });
  }

  end() {
    this.onend?.(new Event("end"));
  }
}

describe("NFC-e voice manual stop lifecycle", () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("ignores a delayed onresult/onend after Parar, preserving manual zeros", () => {
    const onDigits = vi.fn();
    const { result } = renderHook(() => useAccessKeyVoice());

    act(() => {
      expect(result.current.startListening("", onDigits)).toBe(true);
    });
    const first = FakeRecognition.instances[0];

    act(() => first.emit("sete"));
    expect(onDigits).toHaveBeenLastCalledWith("7", false);

    act(() => result.current.stopListening());
    expect(result.current.isListening).toBe(false);

    // The user can now use the +0000 shortcut; the next microphone session
    // starts from those digits instead of the old stale result.
    const zeroCorrected = "70000";
    act(() => {
      first.emit("7 0 0");
      first.end();
    });
    expect(onDigits).toHaveBeenLastCalledWith("7", false);

    act(() => {
      expect(result.current.startListening(zeroCorrected, onDigits)).toBe(true);
    });
    expect(FakeRecognition.instances).toHaveLength(2);
    act(() => FakeRecognition.instances[1].emit("nove seis dois"));
    expect(onDigits).toHaveBeenLastCalledWith("70000962", false);

    act(() => result.current.stopListening());
  });

  it("ignores stale events from a stopped session after a new one starts", () => {
    const onDigits = vi.fn();
    const { result } = renderHook(() => useAccessKeyVoice());
    act(() => result.current.startListening("7", onDigits));
    const first = FakeRecognition.instances[0];

    act(() => result.current.stopListening());
    act(() => result.current.startListening("70000", onDigits));
    const second = FakeRecognition.instances[1];

    act(() => {
      first.emit("700009");
      first.end();
      second.emit("nove");
    });
    expect(onDigits).toHaveBeenLastCalledWith("700009", false);
    act(() => result.current.stopListening());
  });
});
