"use client";

import { useSyncExternalStore } from "react";

/** Punto de corte móvil/escritorio (012): coincide con `md` de Tailwind. */
export const MOBILE_QUERY = "(max-width: 767px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * `true` bajo 768 px. Solo para COMPORTAMIENTO (push vs replace del
 * historial, Enter envía o no, sensores táctiles); el layout se resuelve
 * por clases `md:` para no depender de la hidratación. En SSR es `false`.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );
}
