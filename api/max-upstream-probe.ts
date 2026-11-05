/**
 * TEMPORARY, preview-only investigation of Max's PUBLIC flyer JSON.
 * Remove this function from the branch before merging.
 * No user-provided fetch destinations or credentials.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (process.env.VERCEL_ENV !== "preview" || request.method !== "GET") {
      return Response.json({ error: "DISABLED" }, { status: 404 });
    }
    const upstream = "https://institucional.supermuffato.com.br/webtools/services/api/sm-rds-ofertas.php?action=getOffers&store=150";
    try {
      const response = await fetch(upstream, {
        headers: {accept:"application/json,text/javascript,*/*","user-agent":"Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36"},
        signal:AbortSignal.timeout(10000),
      });
      const raw = (await response.text()).slice(0, 300000);
      let problem = "parse succeeded";
      let position = 0;
      try { JSON.parse(raw); } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
        const m=problem.match(/position\s+(\d+)/i);
        if(m) position=Number(m[1]);
      }
      const flags = {
        firstItem: raw.indexOf('"id":"146709"'),
        firstPosition: raw.indexOf('"position"'),
        firstImage: raw.indexOf('"image"'),
        itemBlocks: (raw.match(/"id":/g)||[]).length,
        unescapedDoubleSlash: raw.indexOf('\\/'),
      };
      return Response.json({status:response.status, size:raw.length,
        problem, position, flags,
        first:raw.slice(0,3000),
        aroundError:raw.slice(Math.max(0,position-350),position+650),
        nearPosition:raw.slice(Math.max(0,flags.firstPosition-280),flags.firstPosition+360),
        last:raw.slice(-650),
      },{headers:{"cache-control":"no-store"}});
    } catch (e) {
      return Response.json({error:e instanceof Error?e.message:"fetch failed"},{status:502});
    }
  },
};
