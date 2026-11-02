/**
 * One slot from SpeechRecognitionEvent.results. Chrome/Android can emit an
 * evolving transcript in *new* final slots, rather than replacing one slot.
 */
export type AccessKeySpeechResultChunk = {
  digits: string;
  isFinal: boolean;
};

/**
 * Assemble the *current* Web Speech results snapshot (never append snapshots).
 *
 * Android trace from 2026-11-02:
 *   "7" → "70" → "7 0" → "7 0 0" → "7 0 0" →
 *   "7 0 0 0" → "7 0 0 0 9" → "7 0 0 0 9 6 2"
 * Every one was in its own isFinal=true slot. Concatenating slots produced
 * 44 bogus digits from a 7-digit native transcript.
 *
 * Prefix growth in at least two steps identifies cumulative hypotheses.
 * A single expansion of an already long (4+ digit) prefix is also treated as
 * cumulative so a long 44-digit hypothesis cannot be duplicated and prematurely
 * stop recognition. Identical-only short slots ("0", "0", "0") are *not*
 * collapsed: they may be real repeated digits. There is no way to distinguish
 * every ASR duplicate from a legitimate repeated spoken group using text alone.
 *
 * This never inserts missing digits. A zero omitted by native ASR must be
 * corrected by the user, not guessed by the application.
 */
export function assembleAccessKeySpeechChunks(
  chunks: readonly AccessKeySpeechResultChunk[],
): { finalDigits: string; interimDigits: string } {
  const meaningful = chunks.filter((chunk) => chunk.digits.length > 0);
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  function append(chunk: AccessKeySpeechResultChunk) {
    (chunk.isFinal ? finalParts : interimParts).push(chunk.digits);
  }

  let run: AccessKeySpeechResultChunk[] = [];
  let growthSteps = 0;

  function flushRun() {
    if (!run.length) return;

    const cumulative =
      growthSteps >= 2 ||
      (growthSteps >= 1 && run[0].digits.length >= 4);

    if (cumulative) {
      // The longest/latest hypothesis already contains every earlier prefix.
      append(run[run.length - 1]);
    } else {
      // Preserve exact repetitions when there is no evidence of cumulative
      // speech output; otherwise real consecutive zeros would be lost.
      run.forEach(append);
    }
    run = [];
    growthSteps = 0;
  }

  for (const chunk of meaningful) {
    const previous = run[run.length - 1];

    if (previous && !chunk.digits.startsWith(previous.digits)) {
      flushRun();
    }

    const prior = run[run.length - 1];
    if (prior && chunk.digits.length > prior.digits.length) {
      growthSteps += 1;
    }

    run.push(chunk);
  }
  flushRun();

  return {
    finalDigits: finalParts.join(""),
    interimDigits: interimParts.join(""),
  };
}
