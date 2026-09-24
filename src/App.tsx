import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import BottomNav from "@/components/BottomNav";
const CHUNK_RELOAD_KEY = "preco360-chunk-reload";

function isChunkLoadError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|dynamically imported module/i.test(
    message,
  );
}

function resilientLazy<T extends { default: React.ComponentType<any> }>(
  loader: () => Promise<T>,
) {
  return lazy(async () => {
    try {
      const loaded = await loader();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return loaded;
    } catch (error) {
      if (
        isChunkLoadError(error) &&
        sessionStorage.getItem(CHUNK_RELOAD_KEY) !== "1"
      ) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
        return await new Promise<T>(() => {});
      }
      throw error;
    }
  });
}

const Index = resilientLazy(() => import("./pages/Index"));
const AuthPage = resilientLazy(() => import("./pages/AuthPage"));
const ProductDetail = resilientLazy(() => import("./pages/ProductDetail"));
const SearchPage = resilientLazy(() => import("./pages/SearchPage"));
const OffersPage = resilientLazy(() => import("./pages/OffersPage"));
const OfferImagesAuditPage = resilientLazy(() => import("./pages/OfferImagesAuditPage"));
const ReceiptImportPage = resilientLazy(() => import("./pages/ReceiptImportPage"));
const FlyerPage = resilientLazy(() => import("./pages/FlyerPage"));
const StorePriceImportPage = resilientLazy(() => import("./pages/StorePriceImportPage"));
const StorePriceHistoryPage = resilientLazy(() => import("./pages/StorePriceHistoryPage"));
const FlyerHistoryPage = resilientLazy(() => import("./pages/FlyerHistoryPage"));
const MarketBasketPage = resilientLazy(() => import("./pages/MarketBasketPage"));
const ProfilePage = resilientLazy(() => import("./pages/ProfilePage"));
const QrLabPage = resilientLazy(() => import("./pages/QrLabPage"));
const NotFound = resilientLazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function PageFallback() {
  return (
    <div className="flex min-h-[45vh] items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-xs">Carregando página…</p>
      </div>
    </div>
  );
}

class RouteErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Route render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-[55vh] items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <p className="font-bold">Não consegui abrir esta página.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            A versão do aplicativo pode ter sido atualizada enquanto estava aberta.
          </p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) return <Suspense fallback={<PageFallback />}><AuthPage /></Suspense>;

  return (
    <>
      <RouteErrorBoundary>
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/upload" element={<ReceiptImportPage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/offers/images" element={<OfferImagesAuditPage />} />
        <Route path="/offers/basket" element={<MarketBasketPage />} />
        <Route path="/offers/store-prices" element={<StorePriceHistoryPage />} />
        <Route path="/radar" element={<FlyerPage />} />
        <Route path="/radar/store-prices" element={<StorePriceImportPage />} />
        <Route path="/radar/history" element={<FlyerHistoryPage />} />
        <Route path="/offers/history" element={<Navigate to="/radar/history" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/qr-lab" element={<QrLabPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </RouteErrorBoundary>
      <BottomNav />
    </>
  );
}

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
