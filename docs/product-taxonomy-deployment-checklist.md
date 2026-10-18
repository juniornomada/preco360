# Taxonomia: checklist antes do PR único

## Estado confirmado (consulta somente leitura)
- Produtos: 271. Classificação SQL = **228 high / 37 review / 6 unknown**.
- Ofertas: 8.148. Classificação SQL = **5.693 high / 907 review / 1.548 unknown**.
- Antes do deploy, todos os 271 produtos permanecem com `category='Geral'`.
- Testes específicos e build da branch passaram; a suíte geral tem as mesmas 7 falhas de asserção e 2 erros de carregamento de testes de voz vistos na main (variáveis Supabase ausentes na CI).

## Ordem dos scripts (somente no deploy aprovado)
1. `20261018184000_snapshot_product_taxonomy_before_change.sql` **obrigatório**: registra categoria, peso, unidade e imagem originais dos produtos numa tabela protegida por RLS (sem permissões do app). Validar que a quantidade de registros capturados é igual à quantidade de produtos do momento.
2. `20261018184500_fix_verified_da_feira_pastel_package.sql` atualiza apenas embalagem 1 kg da massa Da Feira, se ainda estiver vazia.
3. `20261018185500_verified_pastel_roll_product_images.sql` preenche imagens São Judas e Da Feira apenas se não houver imagem.
4. `20261018190000_product_taxonomy_schema.sql` acrescenta metadados sem alterar histórico.
5. `20261018190100` a `20261018190400` registram regras de categorização ordenadas.
6. `20261018190500_product_taxonomy_classifier.sql` adiciona classificador e triggers para novos nomes.
7. `20261018190600_backfill_product_taxonomy.sql` aplica somente categorias de alta confiança quando o campo atual é Geral; classifica ofertas em colunas independentes.

## Guardrails
- Nunca usar categoria/família isolada como identidade de SKU para comparar preços.
- Não alterar `prices`, `product_aliases`, `product_id`, marca, peso ou valor pago com o backfill.
- RLS de produtos e ofertas continua vinculada ao `user_id`. Regras são globais e só leitura para usuários autenticados.
- Itens de confiança `review` e sem resultado continuam sujeitos à revisão manual.
- Antes do PR, validar fotos de rolo (não disco/quadrada), componente Cotar em largura móvel e os totais após deploy em ambiente adequado.
- Após aplicação, conferir distribuição de `taxonomy_confidence`, quantidade de categorias não Gerais, 319 históricos de preço (ou novo total), e contagens por usuário em consulta não destrutiva. O total de históricos pode crescer entre auditoria e publicação.
- **Ainda não executado no Supabase de produção.**

Para validar contagens após o deploy:
```sql
SELECT taxonomy_confidence, count(*) FROM public.products
GROUP BY taxonomy_confidence ORDER BY taxonomy_confidence;
SELECT taxonomy_confidence, count(*) FROM public.flyer_items
GROUP BY taxonomy_confidence ORDER BY taxonomy_confidence;
SELECT count(*) FROM public.prices;
```

## Plano de reversão, sem ambiente pago separado
- **Arquivo manual**: `docs/rollback-product-taxonomy-20261018.sql` (fora das migrations; não é executado automaticamente).
- Reverter primeiro a versão do aplicativo ou coordenar manutenção. Executar rollback transacional sob acesso autorizado: remover os dois gatilhos automáticos, recuperar categorias originais dos registros não alterados manualmente, reverter as duas URLs específicas e o pacote Da Feira se ainda corresponderem ao que este PR instalou, e limpar os novos metadados.
- Não eliminar colunas/tabelas de uma vez: uma versão antiga ou nova em execução pode depender delas; manter snapshot protegido para auditoria.
- **Limites**: não equivale a restauração integral de um banco. Snapshot contém os produtos existentes no instante da captura; produtos criados depois precisam de revisão separada. Alterações manuais feitas após a implantação não devem ser sobrescritas automaticamente. O registro da migração aplicada continua no histórico do Supabase e exige planejamento se for reaplicar no futuro.
- Antes de qualquer aplicação real, confirmar privilégios da tabela protegida e uma janela de execução; nunca rodar o rollback sem detectar o motivo da falha.
