// English and Spanish, like the desktop app: every string is written in both
// at the point of use, `t("Loans", "Préstamos")`. The language is a per-device
// preference (defaulting to the business's language, then the browser's).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../../shared/domain/dates";

export type T = (en: string, es: string) => string;

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: T;
}

const KEY = "acervus.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "es") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

const LangContext = createContext<LangState | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<LangState>(() => ({ lang, setLang, t: (en, es) => (lang === "es" ? es : en) }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangState {
  const v = useContext(LangContext);
  if (!v) throw new Error("LangProvider missing");
  return v;
}

export function useT(): T {
  return useLang().t;
}

/** "1 loan" / "3 loans". */
export function plural(t: T, n: number, one: [string, string], many: [string, string]): string {
  return `${n} ${n === 1 ? t(...one) : t(...many)}`;
}
