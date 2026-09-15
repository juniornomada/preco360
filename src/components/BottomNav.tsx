import { Home, BadgeDollarSign, ScanLine, Tags, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

const navItems = [
  { icon: Home, label: "Início", path: "/" },
  { icon: BadgeDollarSign, label: "Cotar", path: "/search" },
  { icon: Tags, label: "Ofertas", path: "/offers" },
  { icon: ScanLine, label: "Cupom", path: "/upload" },
  { icon: User, label: "Perfil", path: "/profile" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className="bottom-nav">
      {navItems.map((item) => {
        const isActive = location.pathname === item.path;
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
