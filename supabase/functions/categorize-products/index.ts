import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { products } = await req.json();

    if (!products || !Array.isArray(products) || products.length === 0) {
      return new Response(JSON.stringify({ categories: {} }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const productNames = products.map((p: string) => p.trim()).join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `Você é um classificador de produtos de supermercado brasileiro. Categorize cada produto em UMA das seguintes categorias:
Frutas, Verduras e Legumes, Carnes, Laticínios, Padaria, Bebidas, Limpeza, Higiene, Congelados, Enlatados, Temperos e Condimentos, Grãos e Cereais, Doces e Snacks, Pet, Outros.

Use a tool call para retornar o resultado.`,
          },
          {
            role: "user",
            content: `Categorize estes produtos:\n${productNames}`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "categorize",
              description: "Categorize each product. Return one entry per product.",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string", description: "Exact product name" },
                        category: { type: "string", description: "Category name" },
                      },
                      required: ["name", "category"],
                    },
                  },
                },
                required: ["items"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "categorize" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI categorization failed");
    }

    const data = await response.json();
    console.log("AI response:", JSON.stringify(data));
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let categories: Record<string, string> = {};

    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        // Convert array format to map
        if (parsed.items && Array.isArray(parsed.items)) {
          for (const item of parsed.items) {
            if (item.name && item.category) {
              categories[item.name] = item.category;
            }
          }
        } else if (parsed.categories) {
          categories = parsed.categories;
        }
      } catch {
        console.error("Failed to parse tool call arguments");
      }
    }

    // Fallback: try parsing content as JSON if no tool call
    if (Object.keys(categories).length === 0) {
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.name && item.category) categories[item.name] = item.category;
            }
          } else {
            categories = parsed.categories || parsed || {};
          }
        } catch {
          console.warn("Content is not JSON either");
        }
      }
    }

    return new Response(JSON.stringify({ categories }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("categorize-products error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
