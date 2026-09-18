"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { cn } from "@/lib/utils";
import {
  clampReveal,
  classifySwipe,
  isEdgeSwipeBack,
  longPressCancelled,
  settleReveal,
  type GesturePoint,
  type SwipeAxis,
} from "@/lib/gestures";

/**
 * Gesto «volver» estilo iOS (012, FR-005): deslizar desde el borde
 * izquierdo del elemento referenciado. Da feedback moviendo el elemento y,
 * si el recorrido alcanza, llama `onBack`. `touchcancel` (p. ej. Safari
 * tomando su propio gesto de historial) NUNCA dispara el back: evita el
 * doble retroceso.
 */
export function useSwipeBack<T extends HTMLElement>(
  onBack: () => void,
  enabled = true
) {
  const ref = useRef<T>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: GesturePoint | null = null;
    let axis: SwipeAxis = "pending";
    let dx = 0;
    let dy = 0;

    const reset = (animated: boolean) => {
      el.style.transition = animated ? "transform 180ms ease-out" : "";
      el.style.transform = "";
      start = null;
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > 32) return;
      start = { x: t.clientX, y: t.clientY };
      axis = "pending";
      dx = 0;
      dy = 0;
      el.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      const cur = { x: t.clientX, y: t.clientY };
      if (axis === "pending") axis = classifySwipe(start, cur);
      if (axis !== "horizontal") return;
      dx = Math.max(0, cur.x - start.x);
      dy = cur.y - start.y;
      el.style.transform = `translateX(${dx}px)`;
    };
    const onEnd = () => {
      if (!start) return;
      const back = axis === "horizontal" && isEdgeSwipeBack(start.x, dx, dy);
      if (!back) {
        reset(true);
        return;
      }
      el.style.transition = "transform 160ms ease-out";
      el.style.transform = "translateX(100%)";
      start = null;
      window.setTimeout(() => {
        el.style.transition = "";
        el.style.transform = "";
        onBackRef.current();
      }, 150);
    };
    const onCancel = () => reset(false);

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
      el.style.transition = "";
      el.style.transform = "";
    };
  }, [enabled]);

  return ref;
}

/**
 * Mantener apretado (012, FR-006). Devuelve handlers táctiles para el
 * elemento; si el dedo se mueve (scroll) se cancela, y tras dispararse se
 * suprime el click sintético (`preventDefault` en touchend) para que la
 * fila no se abra además de seleccionarse.
 */
export function useLongPress(
  onLongPress: () => void,
  { delay = 450, enabled = true }: { delay?: number; enabled?: boolean } = {}
) {
  const timer = useRef<number | null>(null);
  const start = useRef<GesturePoint | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => clear, []);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (!enabled) return;
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY };
    fired.current = false;
    clear();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      fired.current = true;
      cb.current();
    }, delay);
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!start.current || !t) return;
    if (longPressCancelled(start.current, { x: t.clientX, y: t.clientY })) {
      clear();
    }
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    clear();
    if (fired.current && e.cancelable) e.preventDefault();
    start.current = null;
  };
  const onTouchCancel = () => {
    clear();
    start.current = null;
  };
  const onContextMenu = (e: React.MouseEvent) => {
    // El menú contextual del long-press nativo compite con el nuestro.
    if (fired.current || timer.current !== null) e.preventDefault();
  };

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onContextMenu },
    fired,
  };
}

/**
 * Fila deslizable estilo WhatsApp (012, FR-006): deslizar a la izquierda
 * revela `actions` (ancho `revealWidth`). Solo una fila abierta a la vez:
 * el padre guarda `openId`. Un scroll vertical cancela el gesto. En
 * escritorio (sin touch) no interviene.
 */
export function SwipeRow({
  id,
  openId,
  onOpenChange,
  actions,
  revealWidth = 144,
  disabled = false,
  className,
  children,
}: {
  id: string;
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  actions: ReactNode;
  revealWidth?: number;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const open = openId === id;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<GesturePoint | null>(null);
  const axis = useRef<SwipeAxis>("pending");
  const base = useRef(0);
  const moved = useRef(false);

  useEffect(() => {
    setDx(open ? -revealWidth : 0);
  }, [open, revealWidth]);

  const onTouchStart = (e: ReactTouchEvent) => {
    if (disabled) return;
    const t = e.touches[0];
    if (!t) return;
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = "pending";
    base.current = open ? -revealWidth : 0;
    moved.current = false;
  };
  const onTouchMove = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (!start.current || !t) return;
    const cur = { x: t.clientX, y: t.clientY };
    if (axis.current === "pending") axis.current = classifySwipe(start.current, cur);
    if (axis.current === "vertical") {
      start.current = null;
      if (dragging) {
        setDragging(false);
        setDx(open ? -revealWidth : 0);
      }
      return;
    }
    if (axis.current !== "horizontal") return;
    moved.current = true;
    if (!dragging) setDragging(true);
    setDx(clampReveal(base.current + (cur.x - start.current.x), revealWidth));
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    if (!start.current) return;
    start.current = null;
    if (axis.current !== "horizontal") return;
    const shouldOpen = settleReveal(dx, revealWidth, open);
    setDragging(false);
    setDx(shouldOpen ? -revealWidth : 0);
    onOpenChange(shouldOpen ? id : null);
    // Un deslizamiento no es un toque: no abrir la fila.
    if (moved.current && e.cancelable) e.preventDefault();
  };

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div
        className="absolute inset-y-0 right-0 flex"
        style={{ width: revealWidth }}
        aria-hidden={!open}
      >
        {actions}
      </div>
      <div
        className="relative bg-background"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          start.current = null;
          setDragging(false);
          setDx(open ? -revealWidth : 0);
        }}
        onClickCapture={
          open
            ? (e) => {
                // Con acciones visibles, tocar la fila solo la cierra.
                e.preventDefault();
                e.stopPropagation();
                onOpenChange(null);
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
