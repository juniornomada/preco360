import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

const db = supabase as any;
const LEGACY_BASKET_KEY = "preco360-basket-selection-v2";

function readLocalBasket(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const clean: Record<string, number> = {};
    for (const [itemKey, rawQuantity] of Object.entries(parsed)) {
      const quantity = Number(rawQuantity);
      if (!itemKey || !Number.isFinite(quantity) || quantity <= 0) continue;
      clean[itemKey] = Math.max(1, Math.min(99, Math.round(quantity)));
    }

    return Object.keys(clean).length > 0 ? clean : null;
  } catch {
    return null;
  }
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;

    const migrateExistingBasket = async () => {
      const userStorageKey = `${LEGACY_BASKET_KEY}:${user.id}`;
      const localSelection =
        readLocalBasket(userStorageKey) ?? readLocalBasket(LEGACY_BASKET_KEY);

      if (!localSelection) return;

      const { data, error } = await db
        .from("user_baskets")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled || error || data) return;

      const { error: migrationError } = await db
        .from("user_baskets")
        .upsert(
          { user_id: user.id, selection: localSelection },
          { onConflict: "user_id" },
        );

      if (cancelled || migrationError) return;

      try {
        localStorage.setItem(userStorageKey, JSON.stringify(localSelection));
        localStorage.removeItem(LEGACY_BASKET_KEY);
      } catch {
        // Supabase is now the source of truth; local storage is only a cache.
      }
    };

    void migrateExistingBasket();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
