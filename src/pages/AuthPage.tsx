import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  BadgeDollarSign,
  LineChart,
  Lock,
  Mail,
  ReceiptText,
  ShieldCheck,
} from "lucide-react";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({
          title: "Conta criada!",
          description: "Verifique seu e-mail para confirmar o cadastro.",
        });
      }
    } catch (error: any) {
      toast({
        title: "Não foi possível continuar",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:flex lg:items-center lg:py-10">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-3xl border bg-card shadow-xl lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden bg-secondary p-7 text-secondary-foreground sm:p-10 lg:p-12">
          <div className="relative z-10 flex h-full flex-col">
            <div className="mb-10 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
                <BadgeDollarSign className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-extrabold tracking-tight">Preço 360</h1>
                <p className="text-xs text-white/55">Seu histórico antes de comprar</p>
              </div>
            </div>

            <div className="max-w-xl">
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-primary">Compre melhor</p>
              <h2 className="text-3xl font-extrabold leading-tight sm:text-4xl lg:text-5xl">
                Descubra se a promoção está realmente barata.
              </h2>
              <p className="mt-5 max-w-lg text-sm leading-6 text-white/65 sm:text-base">
                Registre preços por cupom fiscal ou durante a compra, acompanhe a evolução de cada produto e use seu próprio histórico para decidir a hora de comprar.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:mt-10 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <ReceiptText className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Leia cupons</p>
                <p className="mt-1 text-xs leading-5 text-white/50">Construa seu histórico automaticamente.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <LineChart className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Veja a evolução</p>
                <p className="mt-1 text-xs leading-5 text-white/50">Compare o preço atual com o passado.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <ShieldCheck className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm font-semibold">Decida com dados</p>
                <p className="mt-1 text-xs leading-5 text-white/50">Saiba quando comprar, esperar ou estocar.</p>
              </div>
            </div>

            <p className="mt-auto pt-10 text-xs text-white/35">Preço 360 · seu histórico, suas decisões.</p>
          </div>

          <div className="pointer-events-none absolute -bottom-32 -right-28 h-80 w-80 rounded-full bg-primary/10 blur-2xl" />
          <div className="pointer-events-none absolute -left-20 top-1/3 h-56 w-56 rounded-full bg-primary/5 blur-2xl" />
        </section>

        <section className="flex items-center justify-center p-6 sm:p-10 lg:p-12">
          <Card className="w-full max-w-md border-0 shadow-none">
            <CardContent className="p-0">
              <div className="mb-8">
                <p className="text-sm font-semibold text-primary">{isLogin ? "Bem-vindo de volta" : "Comece seu histórico"}</p>
                <h2 className="mt-1 text-3xl font-extrabold tracking-tight">
                  {isLogin ? "Entre no Preço 360" : "Crie sua conta"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {isLogin
                    ? "Acesse seus produtos, preços registrados e análises."
                    : "Cadastre-se para começar a acompanhar o preço real das suas compras."}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="voce@email.com"
                      className="h-11 pl-10"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Mínimo de 6 caracteres"
                      className="h-11 pl-10"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <Button type="submit" className="h-11 w-full text-sm font-semibold" disabled={loading}>
                  {loading ? "Aguarde..." : isLogin ? "Entrar" : "Criar minha conta"}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </form>

              <div className="mt-6 border-t pt-6 text-center">
                <p className="text-sm text-muted-foreground">
                  {isLogin ? "Ainda não tem uma conta?" : "Já tem uma conta?"}
                </p>
                <button
                  type="button"
                  onClick={() => setIsLogin((value) => !value)}
                  className="mt-1 text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  {isLogin ? "Cadastre-se gratuitamente" : "Entrar na minha conta"}
                </button>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
