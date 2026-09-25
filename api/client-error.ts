import type { VercelRequest, VercelResponse } from "@vercel/node";

function clean(value: unknown, max = 6000) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.slice(0, max);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};

  console.error("CLIENT_RENDER_ERROR", {
    message: clean((body as any).message, 2000),
    name: clean((body as any).name, 200),
    stack: clean((body as any).stack, 7000),
    componentStack: clean((body as any).componentStack, 7000),
    path: clean((body as any).path, 1000),
    href: clean((body as any).href, 2000),
    userAgent: clean((body as any).userAgent, 1000),
  });

  return res.status(204).end();
}
