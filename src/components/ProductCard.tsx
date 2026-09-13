import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ProductCardProps {
  id: string;
  name: string;
  category: string;
  bestPrice: number;
  bestSupermarket: string;
  bestDate: string;
  disableNav?: boolean;
}

export default function ProductCard({
  id,
  name,
  category,
  bestPrice,
  bestSupermarket,
  bestDate,
  disableNav,
}: ProductCardProps) {
  const navigate = useNavigate();

  const handleNav = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disableNav) navigate(`/product/${id}`);
  };

  return (
    <Card className="transition-shadow hover:shadow-md active:scale-[0.99]">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <TrendingDown className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-card-foreground">{name}</p>
          <p className="text-xs text-muted-foreground">{category}</p>
        </div>
        <div className="text-right">
          <p className="font-bold text-primary">
            R$ {bestPrice.toFixed(2).replace(".", ",")}
          </p>
          <p className="text-xs text-muted-foreground">@{bestSupermarket}</p>
        </div>
        <button onClick={handleNav} className="shrink-0 rounded p-1 hover:bg-muted">
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
      </CardContent>
    </Card>
  );
}
