# Remix of Preço Certo

Crie app full-stack "Preço Tracker" para rastrear preços supermercados BR usando APENAS o banco nativo do Lovable (sem Supabase externo). Design mobile-first, PT-BR.

**DB Schema auto (tabelas nativas):**
- products: id (auto), name (string), category (string), userId (string)
- prices: id (auto), productId (string), supermarket (string), price (number), date (date), imageUrl (string), receiptText (string), userId (string)

**Páginas e Fluxo:**
1. **Home/Dashboard:** Tabela produtos com melhor preço (query: MIN(price) por product + supermarket). Filtros categoria/supermercado. Gráfico linha histórico preços (Chart.js). Botão "Novo produto".
2. **Novo manual:** Form modal: nome, categoria, preço, supermercado, data. Salva product/price.
3. **Upload Cupom:** Drag imagem (jpg/png) ou PDF. Botões: "QR Code" (jsQR lib), "OCR Texto" (Tesseract.js para extrair itens/preços/supermercado). Preview tabela editável (confirme produtos/preços), salve múltiplos.
4. **Detalhe Produto:** Histórico lista + gráfico preços por data/supermercado.
5. **Auth:** Login Lovable nativo (email/Google), dados filtrados por userId.

**Lógica OCR/QR (client-side, sem backend extra):**
- QR: jsQR decodifica > parse XML NF-e para itens/preços (fetch XML se link).
- Imagem/PDF: pdf.js converte PDF>canvas, Tesseract.js OCR > regex BR cupons ("ARROZ.*R\\$\\s*([0-9,]+)"). Sugira match produtos existentes.
- Armazene imagem no storage Lovable, texto parseado.

**UI clean:**
- Cards produtos: "Arroz 5kg - Melhor: R$10 @Supermercado B".
- Toasts feedback.
- Search global.
- Tema verde, responsive.

**Libs:**
- Chart.js, Tesseract.js, jsQR, pdf.js.
- Upload imagens storage nativo.

Mock dados: Arroz Superm A R$12 (2026-03-14), Superm B R$10 (2026-03-21). Código pronto/deploy. Teste upload imagem mock.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/dcf8ddee-c2b2-4b5a-84fb-150bbff00b4e).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
