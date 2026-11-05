/**
 * A Kawakami campaign can gain extra sheets (for example VIRTUAL_* sheets)
 * without changing its printed validity period. A processed campaign is
 * reusable only if the complete set of captured page CONTENTS is identical.
 *
 * The collector downloads and hashes each actual image before calling this
 * function. Its combinedHash includes the ordered hash of EVERY page.
 */
export function isUnchangedKawakamiCampaign(
  previous: {
    status?: string | null;
    file_hash?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
  } | null | undefined,
  current: {
    fileHash: string;
    validFrom: string;
    validTo: string;
  },
): boolean {
  return Boolean(
    previous &&
    (previous.status === "processed" || previous.status === "unchanged") &&
    previous.file_hash &&
    current.fileHash &&
    previous.file_hash === current.fileHash &&
    previous.valid_from === current.validFrom &&
    previous.valid_to === current.validTo,
  );
}
