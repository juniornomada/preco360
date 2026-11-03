/**
 * Distinguish server-to-SEFAZ transport failures from an unavailable fiscal
 * document. The native phone browser may still access the official receipt.
 */
export function isReceiptServerTransportFailure(code: string) {
  return code === "UPSTREAM_NETWORK";
}

export function offersReceiptFileRecovery(code: string) {
  return code === "UPSTREAM_NETWORK" || code === "PORTAL_REJECTED";
}

export function receiptImportErrorDescription(code: string, original: string) {
  if (isReceiptServerTransportFailure(code)) {
    return "O servidor do Preço 360 não conseguiu estabelecer a conexão com a SEFAZ-SP. Isso não significa que o cupom esteja indisponível no seu navegador. Abra a consulta oficial e salve o cupom como PDF ou imagem para importar.";
  }
  return original;
}
