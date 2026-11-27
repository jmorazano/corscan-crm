import { describe, expect, it } from "vitest";
import { displayContactName, eventText } from "@/lib/conversation-events";
import { nameEditFrom, nameEditedLabel } from "@/lib/contact-name-edit";

/** Quién cambió el nombre del contacto: línea del hilo y marca de la ficha. */
const hhmm = (iso: string) => iso.slice(11, 16);

describe("línea «cambió el nombre» en el hilo", () => {
  it("dice quién del equipo lo cambió, de qué a qué", () => {
    const { text, tone } = eventText(
      {
        kind: "contact_renamed",
        reason: "team",
        actorName: "Soraya Lucero",
        details: { from: "5493517072191", to: "GIGI - miracielos 504" },
      },
      hhmm
    );
    expect(text).toBe("Soraya Lucero cambió el nombre del contacto: «+5493517072191» → «GIGI - miracielos 504».");
    expect(tone).toBe("neutral");
  });

  it("sin nombre de la cuenta (borrada) no inventa a nadie", () => {
    const { text } = eventText(
      { kind: "contact_renamed", reason: "team", actorName: null, details: { from: "Ana", to: "Ana López" } },
      hhmm
    );
    expect(text).toBe("Alguien del equipo cambió el nombre del contacto: «Ana» → «Ana López».");
  });

  it("el nombre que anotó la IA", () => {
    const { text } = eventText(
      { kind: "contact_renamed", reason: "agent", actorName: null, details: { from: "Santi 🌊", to: "Santiago Pintos" } },
      hhmm
    );
    expect(text).toBe("La IA anotó el nombre que dio el cliente: «Santiago Pintos» (antes «Santi 🌊»).");
  });

  it("un nombre que todavía es el número se muestra como teléfono", () => {
    expect(displayContactName("5493517072191")).toBe("+5493517072191");
    expect(displayContactName("Gigi 504")).toBe("Gigi 504");
    expect(displayContactName("")).toBe("sin nombre");
    expect(displayContactName(undefined)).toBe("sin nombre");
  });
});

describe("marca «Nombre puesto a mano» de la ficha", () => {
  const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}`;

  it("con quién lo puso", () => {
    const edit = nameEditFrom({ nameEditedAt: "2026-11-26T17:40:57.169Z", nameEditedByName: "Soraya Lucero" });
    expect(edit).toEqual({ at: "2026-11-26T17:40:57.169Z", by: "Soraya Lucero" });
    expect(nameEditedLabel(edit!, fmt)).toBe("Nombre puesto a mano por Soraya Lucero · 26/11 17:40");
  });

  it("ediciones anteriores al registro: lo dice sin adivinar", () => {
    const edit = nameEditFrom({ nameEditedAt: "2026-11-26T17:40:57.169Z", nameEditedByName: null });
    expect(nameEditedLabel(edit!, fmt)).toBe("Nombre puesto a mano · 26/11 17:40 (sin registro de quién)");
  });

  it("sin edición manual no hay marca", () => {
    expect(nameEditFrom({ nameEditedAt: null })).toBeNull();
    expect(nameEditFrom(null)).toBeNull();
    expect(nameEditFrom({})).toBeNull();
  });
});
