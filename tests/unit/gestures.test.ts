import { describe, expect, it } from "vitest";
import {
  clampReveal,
  classifySwipe,
  filterQuickReplies,
  inboxShortcut,
  isEdgeSwipeBack,
  longPressCancelled,
  neighborIndex,
  quickReplyQuery,
  settleReveal,
} from "@/lib/gestures";

describe("classifySwipe", () => {
  it("queda pendiente bajo el umbral", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe("pending");
  });
  it("horizontal cuando dx domina, vertical cuando domina dy", () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: -30, y: 4 })).toBe("horizontal");
    expect(classifySwipe({ x: 0, y: 0 }, { x: 4, y: 30 })).toBe("vertical");
  });
});

describe("isEdgeSwipeBack", () => {
  it("solo desde el borde y con recorrido suficiente", () => {
    expect(isEdgeSwipeBack(10, 100, 5)).toBe(true);
    expect(isEdgeSwipeBack(60, 100, 5)).toBe(false); // lejos del borde
    expect(isEdgeSwipeBack(10, 50, 5)).toBe(false); // corto
    expect(isEdgeSwipeBack(10, 100, 150)).toBe(false); // más vertical que horizontal
  });
});

describe("SwipeRow: clampReveal / settleReveal", () => {
  it("no desliza a la derecha y frena pasado el ancho de acciones", () => {
    expect(clampReveal(40, 144)).toBe(0);
    expect(clampReveal(-100, 144)).toBe(-100);
    expect(clampReveal(-200, 144)).toBe(-(144 + 56 * 0.25));
  });
  it("abre pasada la mitad; cerrada se queda si no llegó", () => {
    expect(settleReveal(-80, 144, false)).toBe(true);
    expect(settleReveal(-60, 144, false)).toBe(false);
  });
  it("abierta se cierra solo si la devolvieron más de tres cuartos", () => {
    expect(settleReveal(-100, 144, true)).toBe(true);
    expect(settleReveal(-30, 144, true)).toBe(false);
  });
});

describe("longPressCancelled", () => {
  it("tolera un temblor pequeño y cancela con scroll", () => {
    expect(longPressCancelled({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
    expect(longPressCancelled({ x: 0, y: 0 }, { x: 0, y: 20 })).toBe(true);
  });
});

describe("inboxShortcut", () => {
  const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("⌘K / Ctrl+K enfoca la búsqueda", () => {
    expect(inboxShortcut({ ...base, key: "k", metaKey: true })).toBe("search");
    expect(inboxShortcut({ ...base, key: "K", ctrlKey: true })).toBe("search");
  });
  it("Alt+↓/↑ navega; sin Alt no hace nada", () => {
    expect(inboxShortcut({ ...base, key: "ArrowDown", altKey: true })).toBe("next");
    expect(inboxShortcut({ ...base, key: "ArrowUp", altKey: true })).toBe("prev");
    expect(inboxShortcut({ ...base, key: "ArrowDown" })).toBeNull();
  });
  it("⌘⇧U marca no leída; Escape siempre es escape", () => {
    expect(
      inboxShortcut({ ...base, key: "u", metaKey: true, shiftKey: true })
    ).toBe("markUnread");
    expect(inboxShortcut({ ...base, key: "Escape" })).toBe("escape");
  });
  it("una letra suelta no dispara nada", () => {
    expect(inboxShortcut({ ...base, key: "k" })).toBeNull();
  });
});

describe("neighborIndex", () => {
  const ids = ["a", "b", "c"];
  it("avanza y retrocede acotado", () => {
    expect(neighborIndex(ids, "a", 1)).toBe(1);
    expect(neighborIndex(ids, "c", 1)).toBe(2);
    expect(neighborIndex(ids, "a", -1)).toBe(0);
  });
  it("sin selección arranca por el extremo correspondiente", () => {
    expect(neighborIndex(ids, null, 1)).toBe(0);
    expect(neighborIndex(ids, null, -1)).toBe(2);
    expect(neighborIndex([], null, 1)).toBe(-1);
  });
});

describe("quick replies con /", () => {
  it("detecta el comando y su filtro", () => {
    expect(quickReplyQuery("/")).toBe("");
    expect(quickReplyQuery("/bienv")).toBe("bienv");
    expect(quickReplyQuery("  /x")).toBe("x");
  });
  it("no se activa dentro de un texto normal", () => {
    expect(quickReplyQuery("hola /x")).toBeNull();
    expect(quickReplyQuery("/con espacio")).toBeNull();
    expect(quickReplyQuery("")).toBeNull();
  });
  it("filtra por nombre o cuerpo", () => {
    const items = [
      { name: "bienvenida", body: "Hola {{1}}" },
      { name: "recordatorio", body: "Tu turno es mañana" },
    ];
    expect(filterQuickReplies(items, "").length).toBe(2);
    expect(filterQuickReplies(items, "turno").map((t) => t.name)).toEqual([
      "recordatorio",
    ]);
    expect(filterQuickReplies(items, "BIEN").map((t) => t.name)).toEqual([
      "bienvenida",
    ]);
  });
});
