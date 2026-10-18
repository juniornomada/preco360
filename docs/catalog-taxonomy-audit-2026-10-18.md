# Auditoria e plano de classificação do catálogo — 18/10/2026

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
