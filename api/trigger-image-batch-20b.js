export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (req.query?.t !== "p360-vercel-trigger-20b-81f29c") return res.status(403).json({ error: "FORBIDDEN" });

  const upstream = await fetch("https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/resolve-flyer-images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "targeted_batch_20260921_b",
      token: "p360-20260921-batch20-4c7e1a"
    })
  });
  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  return res.send(body);
}
