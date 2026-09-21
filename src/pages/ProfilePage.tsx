import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, Laptop, LogOut, Moon, Package, Store, Sun } from "lucide-react";

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const { data: stats } = useQuery({
    queryKey: ["profile-stats-v1", user?.id],
    queryFn: async () => {
      const { data, error } = await db.rpc("profile_stats_v1");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        products: Number(row?.product_count ?? 0),
        prices: Number(row?.price_count ?? 0),
        supermarkets: Number(row?.supermarket_count ?? 0),
      };
    },
    enabled: !!user,
  });

  return (
    <div className="page-container">
      <h1 className="mb-6 text-xl font-bold">Perfil</h1>

      <Card className="mb-6">
        <CardContent className="p-4">
          <p className="font-medium">{user?.email}</p>
          <p className="text-xs text-muted-foreground">
            Conta criada em{" "}
            {user?.created_at
              ? new Date(user.created_at).toLocaleDateString("pt-BR")
              : "-"}
          </p>
        </CardContent>
      </Card>

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="flex flex-col items-center p-4">
            <Package className="mb-1 h-5 w-5 text-primary" />
            <p className="text-2xl font-bold">{stats?.products ?? 0}</p>
            <p className="text-xs text-muted-foreground">Produtos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center p-4">
            <DollarSign className="mb-1 h-5 w-5 text-primary" />
            <p className="text-2xl font-bold">{stats?.prices ?? 0}</p>
            <p className="text-xs text-muted-foreground">Preços</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center p-4">
            <Store className="mb-1 h-5 w-5 text-primary" />
            <p className="text-2xl font-bold">{stats?.supermarkets ?? 0}</p>
            <p className="text-xs text-muted-foreground">Mercados</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="mb-3">
            <p className="font-medium">Aparência</p>
            <p className="text-xs text-muted-foreground">Escolha como o Preço 360 deve aparecer.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={theme === "light" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setTheme("light")}
            >
              <Sun className="h-4 w-4" />
              Claro
            </Button>
            <Button
              type="button"
              variant={theme === "dark" ? "default" : "outline"}
              className="gap-2"
              onClick={() => setTheme("dark")}
            >
              <Moon className="h-4 w-4" />
              Escuro
            </Button>
            <Button
              type="button"
              variant={theme === "system" || !theme ? "default" : "outline"}
              className="gap-2"
              onClick={() => setTheme("system")}
            >
              <Laptop className="h-4 w-4" />
              Sistema
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button variant="destructive" className="w-full" onClick={signOut}>
        <LogOut className="h-4 w-4" />
        Sair da conta
      </Button>
    </div>
  );
}
