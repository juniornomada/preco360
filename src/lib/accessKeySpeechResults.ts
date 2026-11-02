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
 * A substantial one-step growth (two new digits) also qualifies.
 * The recognizer may revise a near-complete hypothesis in a *new* slot:
 * "70" → "70.000" → "70009" → "7000962". A one-digit correction near
 * the end of a long candidate must not end an established cumulative run.
 * Identical-only short slots ("0", "0", "0") are *not* collapsed: they may
 * be genuine repeated digits. Pure text cannot disambiguate every repetition.
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
  let substantialGrowth = false;

  function isRevisedHypothesis(previous: string, next: string) {
    // A substantial shared prefix plus one corrected digit is typical
    // Android re-transcription, as in 70000 -> 70009. Do not collapse
    // uncorroborated revisions: flushRun requires actual prefix growth.
    if (previous.length < 4 || next.length < previous.length) return false;
    if (previous.slice(0, 3) !== next.slice(0, 3)) return false;

    let differences = 0;
    for (let index = 0; index < previous.length; index += 1) {
      if (previous[index] !== next[index]) differences += 1;
      if (differences > 1) return false;
    }
    return differences === 1;
  }

  function flushRun() {
    if (!run.length) return;

    const cumulative =
      growthSteps >= 2 ||
      substantialGrowth ||
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
    substantialGrowth = false;
  }

  for (const chunk of meaningful) {
    const previous = run[run.length - 1];

    if (
      previous &&
      !chunk.digits.startsWith(previous.digits) &&
      !isRevisedHypothesis(previous.digits, chunk.digits)
    ) {
      flushRun();
    }

    const prior = run[run.length - 1];
    if (prior && chunk.digits.startsWith(prior.digits) &&
        chunk.digits.length > prior.digits.length) {
      growthSteps += 1;
      if (chunk.digits.length - prior.digits.length >= 2) {
        substantialGrowth = true;
      }
    }

    run.push(chunk);
  }
  flushRun();

  return {
    finalDigits: finalParts.join(""),
    interimDigits: interimParts.join(""),
  };
}
