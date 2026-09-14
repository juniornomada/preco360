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
    <main className="min-h-[100dvh] bg-background px-3 py-3 sm:px-6 sm:py-6 lg:flex lg:items-center lg:py-10">
      <div className="mx-auto grid w-full max-w-6xl overflow-hidden rounded-2xl border bg-card shadow-lg sm:rounded-3xl sm:shadow-xl lg:grid-cols-[1.08fr_0.92fr]">
        <section className="relative overflow-hidden bg-secondary p-5 text-secondary-foreground sm:p-10 lg:p-12">
          <div className="relative z-10 flex h-full flex-col">
            <div className="mb-4 flex items-center gap-3 sm:mb-10">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 sm:h-11 sm:w-11 sm:rounded-2xl">
                <BadgeDollarSign className="h-5 w-5 sm:h-6 sm:w-6" />
              </div>
              <div>
                <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">Preço 360</h1>
                <p className="text-[11px] text-white/55 sm:text-xs">Seu histórico antes de comprar</p>
              </div>
            </div>

            <div className="max-w-xl">
              <p className="mb-2 hidden text-xs font-bold uppercase tracking-[0.18em] text-primary sm:block">Compre melhor</p>
              <h2 className="max-w-sm text-2xl font-extrabold leading-tight sm:max-w-none sm:text-4xl lg:text-5xl">
                Descubra se a promoção está realmente barata.
              </h2>
              <p className="mt-3 max-w-lg text-xs leading-5 text-white/60 sm:mt-5 sm:text-base sm:leading-6 sm:text-white/65">
                Compare preços, acompanhe seu histórico e compre na hora certa.
                <span className="hidden sm:inline"> Registre preços por cupom fiscal ou durante a compra e acompanhe a evolução de cada produto.</span>
              </p>
            </div>

            <div className="mt-8 hidden gap-3 sm:grid sm:grid-cols-3 lg:mt-10 lg:grid-cols-1 xl:grid-cols-3">
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

            <p className="mt-auto hidden pt-10 text-xs text-white/35 sm:block">Preço 360 · seu histórico, suas decisões.</p>
          </div>

          <div className="pointer-events-none absolute -bottom-32 -right-28 h-80 w-80 rounded-full bg-primary/10 blur-2xl" />
          <div className="pointer-events-none absolute -left-20 top-1/3 h-56 w-56 rounded-full bg-primary/5 blur-2xl" />
        </section>

        <section className="flex items-center justify-center p-5 sm:p-10 lg:p-12">
          <Card className="w-full max-w-md border-0 shadow-none">
            <CardContent className="p-0">
              <div className="mb-5 sm:mb-8">
                <p className="text-xs font-semibold text-primary sm:text-sm">{isLogin ? "Bem-vindo de volta" : "Comece seu histórico"}</p>
                <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {isLogin ? "Entre no Preço 360" : "Crie sua conta"}
                </h2>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground sm:mt-2 sm:text-sm sm:leading-6">
                  {isLogin
                    ? "Acesse seus produtos, preços registrados e análises."
                    : "Cadastre-se para começar a acompanhar o preço real das suas compras."}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-5">
                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="email" className="text-sm">E-mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="voce@email.com"
                      className="h-10 pl-10 sm:h-11"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <Label htmlFor="password" className="text-sm">Senha</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      placeholder="Mínimo de 6 caracteres"
                      className="h-10 pl-10 sm:h-11"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      required
                      minLength={6}
                    />
                  </div>
                </div>

                <Button type="submit" className="h-10 w-full text-sm font-semibold sm:h-11" disabled={loading}>
                  {loading ? "Aguarde..." : isLogin ? "Entrar" : "Criar minha conta"}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </form>

              <div className="mt-4 border-t pt-4 text-center sm:mt-6 sm:pt-6">
                <p className="text-xs text-muted-foreground sm:text-sm">
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
