export default async function handler(req, res) {
  try {
    const r = await fetch("https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/check-gemini-config");
    const body = await r.text();
    res.status(r.status).setHeader("content-type", "application/json").send(body);
  } catch {
    res.status(502).json({ configured: null, reachable: false });
  }
}
