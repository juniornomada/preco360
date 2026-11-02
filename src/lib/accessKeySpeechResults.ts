/**
 * One slot from SpeechRecognitionEvent.results. Distinct slots are distinct
 * recognition segments, even if their transcripts have identical digits.
 */
export type AccessKeySpeechResultChunk = {
  digits: string;
  isFinal: boolean;
};

/**
 * Reassemble the current Web Speech result snapshot.
 *
 * Final results are immutable and interim results can be revised in place.
 * Rebuild the complete snapshot for each onresult call rather than appending
 * successive snapshots or deduplicating equal/cumulative neighbouring text.
 * Text alone cannot distinguish an engine duplicate from a user saying
 * "zero zero", so removing repeated text would silently lose valid digits.
 */
export function assembleAccessKeySpeechChunks(
  chunks: readonly AccessKeySpeechResultChunk[],
): { finalDigits: string; interimDigits: string } {
  const finalParts: string[] = [];
  const interimParts: string[] = [];

  for (const chunk of chunks) {
    if (!chunk.digits) continue;
    (chunk.isFinal ? finalParts : interimParts).push(chunk.digits);
  }

  return {
    finalDigits: finalParts.join(""),
    interimDigits: interimParts.join(""),
  };
}
