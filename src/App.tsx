import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import BottomNav from "@/components/BottomNav";
const Index = lazy(() => import("./pages/Index"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const OffersPage = lazy(() => import("./pages/OffersPage"));
const OfferImagesAuditPage = lazy(() => import("./pages/OfferImagesAuditPage"));
const ReceiptImportPage = lazy(() => import("./pages/ReceiptImportPage"));
const FlyerPage = lazy(() => import("./pages/FlyerPage"));
const FlyerHistoryPage = lazy(() => import("./pages/FlyerHistoryPage"));
const MarketBasketPage = lazy(() => import("./pages/MarketBasketPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const QrLabPage = lazy(() => import("./pages/QrLabPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

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
    <div className="flex min-h-[45vh] items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
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
      <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/upload" element={<ReceiptImportPage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/offers/images" element={<OfferImagesAuditPage />} />
        <Route path="/offers/basket" element={<MarketBasketPage />} />
        <Route path="/radar" element={<FlyerPage />} />
        <Route path="/radar/history" element={<FlyerHistoryPage />} />
        <Route path="/offers/history" element={<Navigate to="/radar/history" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/qr-lab" element={<QrLabPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
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
