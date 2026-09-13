import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from "recharts";

interface PriceChartProps {
  data: { date: string; price: number; supermarket: string }[];
}

export default function PriceChart({ data }: PriceChartProps) {
  const formatted = data
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({
      ...d,
      label: new Date(d.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      priceLabel: `R$ ${d.price.toFixed(2).replace(".", ",")}`,
    }));

  if (formatted.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        Sem dados de preço ainda.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={formatted} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(142, 72%, 29%)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(142, 72%, 29%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v}`} />
        <Tooltip
          formatter={(value: number) => [`R$ ${value.toFixed(2).replace(".", ",")}`, "Preço"]}
          labelFormatter={(label) => label}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid hsl(214, 32%, 91%)",
            fontSize: "12px",
          }}
        />
        <Area
          type="monotone"
          dataKey="price"
          stroke="hsl(142, 72%, 29%)"
          strokeWidth={2}
          fill="url(#priceGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
