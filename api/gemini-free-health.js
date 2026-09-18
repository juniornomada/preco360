export default async function handler(req, res) {
  try {
    const r = await fetch("https://hwpsnipdkwxvvjowomlo.supabase.co/functions/v1/gemini-free-health");
    const body = await r.text();
    res.status(r.status).setHeader("content-type", "application/json").send(body);
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error) });
  }
}
