import { describe, expect, it } from "vitest";
import {
  QUICK_REPLY_BODY_MAX,
  filterQuickPicks,
  greetingName,
  quickPicks,
  quickReplyInput,
  renderQuickReply,
  sanitizeShortcut,
} from "@/lib/quick-replies";

/** 047: respuestas rápidas propias — atajo, `{nombre}`, orden y filtro. */

describe("sanitizeShortcut", () => {
  it.each([
    ["/Seña", "seña"],
    ["Check In", "check-in"],
    ["  /horarios  ", "horarios"],
    ["Ubicación!!", "ubicacion"],
    ["--pago--total--", "pago-total"],
    ["alias_cbu", "alias_cbu"],
  ])("%s → %s", (input, expected) => {
    expect(sanitizeShortcut(input)).toBe(expected);
  });

  it("recorta al tope sin dejar un guion colgando", () => {
    expect(sanitizeShortcut("a".repeat(29) + " b", 30)).toBe("a".repeat(29));
  });
});

describe("quickReplyInput", () => {
  it("sanea atajo y texto", () => {
    expect(quickReplyInput.parse({ shortcut: "/Seña ", body: "  Hola  " })).toEqual({
      shortcut: "seña",
      body: "Hola",
    });
  });

  it("rechaza atajo sin letras, texto vacío o demasiado largo", () => {
    expect(quickReplyInput.safeParse({ shortcut: "///", body: "x" }).success).toBe(false);
    expect(quickReplyInput.safeParse({ shortcut: "ok", body: "   " }).success).toBe(false);
    expect(
      quickReplyInput.safeParse({ shortcut: "ok", body: "x".repeat(QUICK_REPLY_BODY_MAX + 1) })
        .success
    ).toBe(false);
  });
});

describe("renderQuickReply", () => {
  it("reemplaza {nombre} (y {{nombre}}) por el primer nombre", () => {
    expect(renderQuickReply("Hola {nombre}! Gracias {{Nombre}}", "María Pérez")).toBe(
      "Hola María! Gracias María"
    );
  });

  it("sin nombre, el marcador desaparece sin dejar «Hola ,»", () => {
    expect(renderQuickReply("Hola {nombre}, ¿cómo estás?", "")).toBe("Hola, ¿cómo estás?");
    expect(renderQuickReply("Hola {nombre}!\nTe paso el alias", null)).toBe(
      "Hola!\nTe paso el alias"
    );
  });

  it("un contacto cuyo «nombre» es el teléfono no se usa para saludar", () => {
    expect(greetingName("5493364209185")).toBe("");
    expect(greetingName("+54 9 351")).toBe("");
    expect(greetingName("ig:17841400000000000")).toBe("");
    expect(renderQuickReply("Hola {nombre}", "5493364209185")).toBe("Hola");
  });

  it("sin marcador, el texto queda igual", () => {
    expect(renderQuickReply("Precio 1.000 , sin cambios", "Ana")).toBe(
      "Precio 1.000 , sin cambios"
    );
  });
});

describe("quickPicks + filterQuickPicks", () => {
  const picks = quickPicks(
    [
      { id: "qr_2", shortcut: "seña", body: "Te pedimos una seña del 30 %" },
      { id: "qr_1", shortcut: "alias", body: "El alias es altos.calamuchita" },
      { id: "qr_3", shortcut: "reserva", body: "Para la reserva necesitamos la seña" },
    ],
    [{ id: "tpl_1", name: "pago_saldo_recibido", body: "Estimado/a {{1}}…" }]
  );

  it("propias primero (por atajo), plantillas después", () => {
    expect(picks.map((p) => `${p.kind}:${p.key}`)).toEqual([
      "reply:alias",
      "reply:reserva",
      "reply:seña",
      "template:pago_saldo_recibido",
    ]);
  });

  it("el atajo que empieza con lo tipeado va primero; sin tildes", () => {
    expect(filterQuickPicks(picks, "sen").map((p) => p.key)).toEqual(["seña", "reserva"]);
    expect(filterQuickPicks(picks, "SEÑA").map((p) => p.key)).toEqual(["seña", "reserva"]);
  });

  it("vacío lista todo; también busca en plantillas", () => {
    expect(filterQuickPicks(picks, "")).toHaveLength(4);
    expect(filterQuickPicks(picks, "pago").map((p) => p.key)).toEqual(["pago_saldo_recibido"]);
  });
});
