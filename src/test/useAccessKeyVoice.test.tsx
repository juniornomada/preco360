import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccessKeyVoice } from "@/hooks/useAccessKeyVoice";

type Chunk = { transcript: string; final: boolean };

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];
  static nextStartsToReject = 0;
  lang = "";
  interimResults = false;
  continuous = false;
  maxAlternatives = 0;
  onstart: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onresult: ((event: Event) => void) | null = null;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start() {
    if (MockSpeechRecognition.nextStartsToReject > 0) {
      MockSpeechRecognition.nextStartsToReject--;
      throw new Error("Native recognizer is restarting");
    }
    this.onstart?.(new Event("start"));
  }

  stop() {
    this.onend?.(new Event("end"));
  }

  abort() {
    this.onend?.(new Event("end"));
  }

  emit(chunks: Chunk[]) {
    const results = chunks.map((chunk) => ({
      0: { transcript: chunk.transcript },
      length: 1,
      isFinal: chunk.final,
    }));
    this.onresult?.({ results } as unknown as Event);
  }

  finish() {
    this.onend?.(new Event("end"));
  }
}

describe("useAccessKeyVoice no Android", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockSpeechRecognition.instances.length = 0;
    MockSpeechRecognition.nextStartsToReject = 0;
    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
  });

  afterEach(() => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    vi.useRealTimers();
  });

  const start = () => {
    const updates: string[] = [];
    const { result, unmount } = renderHook(() => useAccessKeyVoice());
    act(() => {
      result.current.startListening("", (digits) => updates.push(digits));
    });
    return { result, updates, unmount };
  };

  it("replaces revised interim hypotheses instead of appending them", () => {
    const { updates, unmount } = start();
    const instance = MockSpeechRecognition.instances[0];
    act(() => {
      instance.emit([{ transcript: "3 5 2", final: false }]);
      instance.emit([{ transcript: "3 5 2 6", final: false }]);
      instance.emit([{ transcript: "3 5 2 6", final: false }]);
    });
    expect(updates[updates.length - 1]).toBe("3526");
    unmount();
  });

  it("suppresses duplicated provisional text after a finalized result", () => {
    const { updates, unmount } = start();
    act(() => MockSpeechRecognition.instances[0].emit([
      { transcript: "3 5 2 6", final: true },
      { transcript: "3 5 2 6", final: false },
    ]));
    expect(updates[updates.length - 1]).toBe("3526");
    unmount();
  });

  it("prevents replay when Android auto-restarts after an unfinished hypothesis", () => {
    const { updates, unmount } = start();
    const first = MockSpeechRecognition.instances[0];
    act(() => {
      first.emit([{ transcript: "3 5 2 6", final: false }]);
      first.finish();
      vi.advanceTimersByTime(130);
    });
    expect(MockSpeechRecognition.instances).toHaveLength(2);
    const second = MockSpeechRecognition.instances[1];
    act(() => {
      second.emit([{ transcript: "3 5 2 6", final: false }]);
      second.emit([{ transcript: "3 5 2 6 1 0", final: false }]);
      second.emit([{ transcript: "3 5 2 6 1 0", final: true }]);
    });
    expect(updates[updates.length - 1]).toBe("352610");
    unmount();
  });

  it("keeps replay protection even if one Android restart is rejected", () => {
    const { updates, unmount } = start();
    const first = MockSpeechRecognition.instances[0];
    act(() => {
      first.emit([{ transcript: "3 5 2 6", final: false }]);
      MockSpeechRecognition.nextStartsToReject = 1;
      first.finish();
      vi.advanceTimersByTime(130); // one native start() fails
      vi.advanceTimersByTime(250); // following start() succeeds
    });
    expect(MockSpeechRecognition.instances).toHaveLength(3);
    act(() => MockSpeechRecognition.instances[2].emit([
      { transcript: "3 5 2 6 1 8", final: true },
    ]));
    expect(updates[updates.length - 1]).toBe("352618");
    unmount();
  });

  it("retains real repeated digits in finalized segments", () => {
    const { updates, unmount } = start();
    act(() => MockSpeechRecognition.instances[0].emit([
      { transcript: "zero zero três três três", final: true },
      { transcript: "três cinco dois seis", final: true },
      { transcript: "três cinco dois seis", final: true },
    ]));
    expect(updates[updates.length - 1]).toBe("0033335263526");
    unmount();
  });

  it("ignores callbacks from a canceled recognition session", () => {
    const { result, updates, unmount } = start();
    const previous = MockSpeechRecognition.instances[0];
    act(() => result.current.stopListening());
    act(() => previous.emit([{ transcript: "3 5 2 6", final: true }]));
    expect(updates).toHaveLength(0);
    unmount();
  });

  it("does not stop prematurely on an interim 44-digit hypothesis", () => {
    const { result, updates, unmount } = start();
    const speech = MockSpeechRecognition.instances[0];
    act(() => speech.emit([{ transcript: "3".repeat(44), final: false }]));
    expect(updates[updates.length - 1]).toBe("3".repeat(44));
    expect(result.current.isListening).toBe(true);
    act(() => speech.emit([{ transcript: "3".repeat(43) + "5", final: true }]));
    expect(updates[updates.length - 1]).toBe("3".repeat(43) + "5");
    expect(result.current.isListening).toBe(false);
    unmount();
  });

  it("stops once exactly 44 digits are recognized", () => {
    const { result, updates, unmount } = start();
    const speech = MockSpeechRecognition.instances[0];
    act(() => speech.emit([{ transcript: "3".repeat(44) + "55555", final: true }]));
    expect(updates[updates.length - 1]).toBe("3".repeat(44));
    expect(result.current.isListening).toBe(false);
    unmount();
  });
});
