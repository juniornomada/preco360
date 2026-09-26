import { Home, BadgeDollarSign, ScanLine, ShoppingBasket, Tags, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

const navItems = [
  { icon: Home, label: "Início", path: "/" },
  { icon: BadgeDollarSign, label: "Cotar", path: "/search" },
  { icon: Tags, label: "Ofertas", path: "/offers" },
  { icon: ShoppingBasket, label: "Cesta", path: "/offers/basket" },
  { icon: ScanLine, label: "Cupom", path: "/upload" },
  { icon: User, label: "Perfil", path: "/profile" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => {
        const isActive =
          item.path === "/offers"
            ? location.pathname === "/offers" ||
              location.pathname === "/offers/images" ||
              location.pathname === "/offers/store-prices" ||
              location.pathname.startsWith("/radar")
            : item.path === "/offers/basket"
              ? location.pathname === "/offers/basket"
              : location.pathname === item.path;
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={`bottom-nav-item ${isActive ? "active" : ""}`}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
