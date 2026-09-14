# Preço 360

Preço 360 é um app para acompanhar histórico de preços de supermercado, importar dados de cupons fiscais NFC-e e ajudar a decidir se o preço atual realmente vale a pena.

## Objetivo

O foco do produto é transformar o histórico de compras em uma ferramenta prática de decisão. Em vez de apenas registrar preços, o app compara o valor atual com o histórico do próprio usuário e indica quando um preço está bom, normal, alto ou excepcional.

## Principais recursos

- Cadastro e histórico de preços por produto.
- Cotação rápida de preço durante a compra.
- Análise do preço atual contra o histórico.
- Importação de NFC-e por QR Code ou chave de acesso.
- Revisão dos itens antes de salvar.
- Gráfico de evolução de preço por produto.
- Autenticação e dados separados por usuário.

## Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS + componentes shadcn/ui
- Supabase para autenticação, banco de dados e Edge Functions
- Vercel para deploy

## Desenvolvimento local

Requisitos: Node.js e npm.

```sh
npm install
npm run dev
```

Para gerar a versão de produção:

```sh
npm run build
```

## Variáveis de ambiente

Use `.env.example` como referência e configure:

```env
VITE_SUPABASE_PROJECT_ID="your-project-ref"
VITE_SUPABASE_PUBLISHABLE_KEY="your-publishable-key"
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
```

Nunca exponha chaves privadas ou `service_role` em variáveis com prefixo `VITE_`.

## Estrutura principal

- `src/pages` — páginas da aplicação.
- `src/components` — componentes reutilizáveis.
- `src/lib` — regras de negócio e utilitários.
- `src/integrations/supabase` — cliente e tipos do Supabase.
- `supabase/functions` — Edge Functions usadas pelo backend.
- `supabase/migrations` — evolução do schema do banco.

## Deploy

A branch `main` está conectada ao projeto de produção na Vercel. Alterações enviadas para `main` disparam um novo deploy automaticamente.
