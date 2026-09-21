export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  if (req.query?.t !== "p360-vercel-trigger-43-9a4d21") {
    return res.status(403).json({ error: "FORBIDDEN" });
  }

  const upstream = await fetch(
    "https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/trigger-targeted-image-batch-43?t=p360-trigger-20260920-43-31c8d4"
  );
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  return res.send(text);
}
