/**
 * Additional visual reading instructions for short-lived campaigns.
 *
 * Do not infer an end date from the campaign name or upload timestamp. The
 * model can fill both dates only when the material explicitly establishes
 * a one-day validity period and supplies the associated calendar date.
 * The auto-import finalizer remains the authoritative expiry gate.
 */
export const SINGLE_DAY_FLYER_VALIDITY_GUIDANCE = `
REVISÃO OBRIGATÓRIA DA VALIDADE DE PROMOÇÕES DE UM DIA:
- Examine cabeçalho, faixas laterais, cantos e rodapé de CADA página procurando a frase de validade e a data completa.
- Quando a arte disser explicitamente que as ofertas são válidas em APENAS UM DIA (por exemplo, "somente hoje", "só nesta sexta-feira, 06/11/2026", "ofertas válidas apenas no dia 06/11/2026") E a data estiver inequivocamente legível, preencha valid_from e valid_to com a MESMA data.
- Quando houver intervalo de datas explícito, preserve o intervalo sem reduzir a duração.
- "Dia M", "Super Sexta", "Aniversário", data do arquivo, data de impressão e data de publicação NÃO são, isoladamente, prova de validade de um único dia.
- Se só houver o nome da campanha ou se a data estiver ilegível/incompleta, NÃO invente valid_to. Use null e deixe o sistema bloquear a publicação automática até a validade ser comprovada.
- Nunca transforme uma data inferida ou informação de outra página/rede em validade deste encarte.
`.trim();
