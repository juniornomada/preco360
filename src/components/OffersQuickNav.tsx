import { Radar, ShoppingBasket } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

export default function OffersQuickNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const isOffersArea =
    location.pathname === "/offers" ||
    location.pathname.startsWith("/offers/") ||
    location.pathname === "/radar" ||
    location.pathname.startsWith("/radar/");

  if (!isOffersArea) return null;

  const radarActive =
    location.pathname === "/radar" ||
    location.pathname.startsWith("/radar/");
  const basketActive =
    location.pathname === "/offers/basket";

  const items = [
    {
      label: "Radar 360",
      path: "/radar",
      active: radarActive,
      Icon: Radar,
    },
    {
      label: "Cesta 360",
      path: "/offers/basket",
      active: basketActive,
      Icon: ShoppingBasket,
    },
  ];

  return (
    <div className="fixed bottom-[68px] left-0 right-0 z-40 px-3 pb-2 sm:px-4">
      <div className="mx-auto grid w-full max-w-3xl grid-cols-2 gap-2 rounded-2xl border border-border/80 bg-background/95 p-2 shadow-xl backdrop-blur">
        {items.map(({ label, path, active, Icon }) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            aria-current={active ? "page" : undefined}
            className={
              "flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-bold transition active:scale-[0.99] " +
              (active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/5")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
