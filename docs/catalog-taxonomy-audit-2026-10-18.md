# Auditoria e plano de classificação do catálogo — 18/10/2026

## Resultados medidos na continuação (18/10/2026)

- Catálogo **268**: **225** com categoria de alta confiança, **37** classificados por família ampla mas com subtipo pendente, **6** sem categoria segura (**262/268 = 97,8% com família identificada**).
- Os **6 pendentes**: `AM DORI TORRA BOTECO LASCAS ALHO 320G`, `AM DORI TORRA BOTECO LASCAS CEB 320G`, `BATATA UNI 130G`, `CREME NESTLE 200g`, `DELIKET ACIDO CONF 700G`, `MOL STELLA DORO 300G`. Não inferir pelo preço ou por marca isolada.
- Ofertas: a última auditoria completa concluída, com 157 regras, classificou **6.351/8.148 (77,9%)**, deixando **1.797 registros pendentes** e 1.441 nomes únicos pendentes. **A branch já evoluiu para um conjunto maior de regras, mas um novo recálculo global excedeu o tempo limite SQL; não declarar uma porcentagem nova sem medição.**
- O mapeamento usa o nome principal e sinais explícitos; é diagnóstico **read-only**, não atualiza as tabelas.
- Foram incluídos testes para impedir que uma oferta de tipo desconhecido (`Batata Uni 130g`) herde por alias o histórico de `Batata Palha Uni 100g`.
- Testes específicos `productTaxonomy.test.ts` e `potatoOfferReference.test.ts` **passaram** no workflow de 18/10; o `npm run build` **passou**.
- A suíte completa ainda falha em testes preexistentes ou não relacionados de voz (variáveis de ambiente ausentes no CI), referência histórica de marcas, grupos de cesta básica e imagens; não afirmar que a suíte geral está limpa até comparar com a main e resolver as falhas.
- Não houve alteração no Supabase de produção, e nenhum PR/merge foi realizado para a taxonomia.

### Critérios para liberar o PR futuro
1. Avaliar risco de falso positivo nos casos com `confidence='review'`; só famílias de alta confiança podem ser usadas como referência automática, jamais sozinhas como chave de identidade.
2. Rodar regressões direcionadas e build em branch, corrigindo os casos atribuíveis ao patch e comparando falhas antigas com o baseline.
3. Implementar persistência/backfill controlado e idempotente *depois* de revisão dos impactos na autenticação, RLS e históricos; não forçar nomes ambíguos.
4. Validar no preview a busca `batata`, o filtro entre frutas/raízes, batata frita congelada, palha e chips, sem vencedor global que compare famílias heterogêneas.
5. Abrir PR só após essas verificações e aprovação do comportamento visual.


## Escopo identificado por consulta de leitura ao Supabase

- `products`: **268** produtos, todos com `category='Geral'`.
- `flyer_items`: **8.148** linhas de ofertas, representando **6.142** nomes distintos.
- **8.117** itens das ofertas não têm `product_id` diretamente preenchido.
- `product_aliases`: **374**; `prices`: **319**; `product_images`: **5.014**.
- A palavra batata aparece em **118** itens; **93** começam por batata.
- Na tabela `products`, **108** registros não têm tamanho nem unidade cadastrados.
- O banco está ativo: totais são um retrato da data, não uma contagem permanente.

## Implementação preparada nesta branch

1. Função única `classifyProductName` para reconhecer famílias comuns pelo início do nome; nomes ambíguos retornam `null`.
2. Família batata segmentada em: **inglesa/comum**, **doce**, **baroa**, **pré-frita/congelada**, **palha**, **salgadinho** e **tipo indefinido**.
3. Histórico de batata usa chaves específicas; nunca comparar tipos distintos ou um tipo não identificado com uma categoria definida.
4. Consulta ampla por batata mantém grupos distintos, acrescenta filtros por categoria e não declara uma oferta global vencedora quando há categorias diferentes.
5. Casos de regressão para receitas, encartes e comparações históricas.

## Pendências antes de abrir o PR e aplicar o mapeamento completo

- **Cobertura real do catálogo:** executar a classificação de todos os **268** produtos e dos **6.142** nomes únicos de ofertas (e das novas importações); contabilizar por categoria, alta confiança e pendências. Regras iniciais não são garantia de cobertura total.
- **Dicionário de variantes:** lidar com formas abreviadas da NFC-e, marca, tamanho, variedade, apresentação, fresco/congelado e origem sem confundir ingrediente com produto principal.
- **Persistência:** desenhar migração idempotente para registrar categoria/subcategoria e confiança dos produtos e ofertas, com políticas de acesso adequadas. Preservar `product_id`, chaves fiscais, históricos de preços, unidade, embalagem, preços pagos e preços promocionais.
- **Casos ambíguos:** sinalizar para uma fila de revisão; **nunca** forçar classificação, unir produtos ou modificar históricos como efeito colateral.
- **Testes antes de PR:** executar `npm test`, `npm run build` e verificar no preview o caso do print: batata-baroa, frita congelada, palha, salgadinho e pão de batata.
- **Após validação:** abrir PR e fazer backfill controlado, com contagem antes/depois e relatório de divergências. Nenhuma alteração de dados foi efetuada durante esta auditoria.

> **Importante:** a branch é preparatória. O mapeamento integral dos registros no banco e a execução de testes/build ainda NÃO estão concluídos. Não houve PR, merge ou atualização do banco.
