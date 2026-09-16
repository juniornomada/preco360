import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import BottomNav from "@/components/BottomNav";
import Index from "./pages/Index";
import AuthPage from "./pages/AuthPage";
import ProductDetail from "./pages/ProductDetail";
import SearchPage from "./pages/SearchPage";
import ReceiptImportPage from "./pages/ReceiptImportPage";
import FlyerPage from "./pages/FlyerPage";
import FlyerHistoryPage from "./pages/FlyerHistoryPage";
import ProfilePage from "./pages/ProfilePage";
import QrLabPage from "./pages/QrLabPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function FlyerManageShortcut() {
  const location = useLocation();
  const navigate = useNavigate();

  if (location.pathname !== "/offers") return null;

  return (
    <button
      type="button"
      onClick={() => navigate("/offers/history")}
      className="fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full border bg-background px-3.5 py-2 text-xs font-semibold text-destructive shadow-lg"
      aria-label="Gerenciar e excluir tabloides"
    >
      <Trash2 className="h-4 w-4" />
      Gerenciar tabloides
    </button>
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

  if (!user) return <AuthPage />;

  return (
    <>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/product/:id" element={<ProductDetail />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/upload" element={<ReceiptImportPage />} />
        <Route path="/offers" element={<FlyerPage />} />
        <Route path="/offers/history" element={<FlyerHistoryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/qr-lab" element={<QrLabPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <FlyerManageShortcut />
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
