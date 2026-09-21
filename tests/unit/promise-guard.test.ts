import { describe, expect, it } from "vitest";
import {
  detectBookingPromise,
  safeBookingReply,
  stripBookingPromise,
} from "@/lib/promise-guard";

/**
 * Guarda de promesas de reserva (016, corrección #42 · research D20).
 *
 * Los dos lados importan, pero NO por igual: un falso negativo manda un
 * «te la reservo» a un cliente (malo); un falso positivo le saca al agente la
 * capacidad de explicar cómo se reserva, que es su trabajo principal (peor,
 * porque rompe el camino feliz de todas las conversaciones).
 */

const ENLACE = "https://altosdecalamuchita.com/propiedad/AC-003?cid=cv_123";

// ---------------------------------------------------------------------------
// DEBEN dar positivo: el agente promete, retiene, confirma o toma seña
// ---------------------------------------------------------------------------

const PROMESAS = [
  "Dale, te la reservo para el finde.",
  "Te lo reservé a tu nombre, quedate tranquilo.",
  "Buenísimo, queda reservada del 7 al 9 de noviembre.",
  "Ya te la bloqueo hasta mañana al mediodía.",
  "Te guardo la cabaña hasta el viernes.",
  "Listo, reservada.",
  "Te confirmo la reserva para 6 personas.",
  "Quedó confirmada la estadía, cualquier cosa avisá.",
  "Te la aparto por 24 horas.",
  "Te la separo y después vemos lo del pago.",
  "Ya está reservado, no te preocupes.",
  "Te la voy a reservar ahora mismo.",
  "Te lo voy a guardar hasta que confirmes.",
  "La reservé a tu nombre recién.",
  "Te lo dejo tomado hasta mañana.",
  "Te la dejo guardada para esas fechas.",
  "Estoy reservando la cabaña para ustedes.",
  "Te la bloqueamos por hoy.",
  "Te tomo la seña por transferencia y listo.",
  "Señá por transferencia y te la guardo.",
  "Ya te lo aparté, era la última disponible.",
  "Te la congelo por 48 horas.",
  "Perfecto, confirmada.",
  "Quedan reservadas las dos cabañas.",
  "Me encargo yo de la reserva, vos despreocupate.",
  "La cabaña queda a tu nombre.",
  "Te la tengo apartada hasta el jueves.",
  "Puedo reservarte la cabaña si querés.",
  "Podemos reservarla nosotros y después nos arreglamos.",
  "Ya te la dejo anotada como reservada.",
  // sin tildes: el modelo se las come todo el tiempo
  "te lo reserve para el finde",
  "quedo confirmada la reserva",
];

describe("detectBookingPromise · promesas que DEBEN detectarse", () => {
  for (const frase of PROMESAS) {
    it(`detecta: ${frase}`, () => {
      const resultado = detectBookingPromise(frase);
      expect(resultado.promises, frase).toBe(true);
      expect(resultado.match).toBeTruthy();
      // el fragmento se recorta del texto ORIGINAL, no del normalizado
      expect(frase).toContain(resultado.match as string);
    });
  }
});

// ---------------------------------------------------------------------------
// NO deben dar positivo: es lo que el agente SÍ tiene que poder decir
// ---------------------------------------------------------------------------

const LEGITIMAS = [
  "Para reservar entrá al enlace que te paso.",
  "La reserva se completa en el sitio del alojamiento.",
  "Podés reservarla desde la página, con tarjeta o transferencia.",
  "La seña se paga al reservar, directamente en el sitio.",
  "¿Querés que te pase el enlace para reservar?",
  "No te la reservo yo: la reserva la hacés vos en el sitio.",
  "Te confirmo que hay lugar para esas fechas.",
  "Te dejo el enlace de la cabaña para que veas las fotos.",
  "Te guardo el número por si necesitás algo más adelante.",
  "Tengo El Ciervo a $248.000 las 2 noches para 6 personas.",
  "La cabaña está disponible del 7 al 9 de noviembre.",
  "No hacemos reservas por WhatsApp, se completan en la web.",
  "La reserva queda confirmada cuando completás el pago en el sitio.",
  "Reservá vos desde el sitio y cualquier duda me escribís.",
  "El check-in es a las 14 y la salida a las 10.",
  "La política de cancelación la fija el alojamiento al reservar.",
  "Se reserva online, con confirmación inmediata del sistema.",
  "Te paso el enlace y desde ahí elegís las fechas.",
  "¿Para cuántas personas y qué fechas querés que busque?",
  "El alojamiento pide una seña del 30% al reservar.",
  "Te lo tomo como un sí y te busco opciones para ese finde.",
  "Nosotros no tomamos la reserva: la confirma el sitio del alojamiento.",
  "La reserva se hace online y queda confirmada al instante.",
  "Esas fechas ya están reservadas por otro huésped.",
  "Tenemos la cabaña reservada para otro grupo esas fechas.",
  "Ahí te lo dejo anotado y te aviso si se libera.",
  "No puedo reservarte nada, eso lo hacés vos en el sitio.",
  "Podés reservarla vos y, si no te toma la tarjeta, me escribís.",
];

describe("detectBookingPromise · frases legítimas que NO deben disparar", () => {
  for (const frase of LEGITIMAS) {
    it(`no dispara: ${frase}`, () => {
      const resultado = detectBookingPromise(frase);
      expect(resultado.promises, `${frase} → ${resultado.match ?? ""}`).toBe(false);
      expect(resultado.match).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Casos de borde de la detección
// ---------------------------------------------------------------------------

describe("detectBookingPromise · bordes", () => {
  it("texto vacío, espacios, null y undefined no disparan", () => {
    for (const entrada of ["", "   ", "\n\n", null, undefined]) {
      expect(detectBookingPromise(entrada).promises).toBe(false);
    }
  });

  it("encuentra la promesa aunque venga al final de un mensaje largo y correcto", () => {
    const texto =
      "Tengo El Ciervo a $248.000 las 2 noches para 6 personas, del 7 al 9 de " +
      "noviembre. La reserva se completa en el sitio, te paso el enlace. " +
      "Igual, si querés, te la reservo yo y después vemos.";
    const resultado = detectBookingPromise(texto);
    expect(resultado.promises).toBe(true);
    expect(resultado.match).toContain("te la reservo");
  });

  it("los emojis y la puntuación no rompen el recorte del fragmento", () => {
    const texto = "¡Listo! 🎉 te la reservo 👉 nos vemos el finde";
    const resultado = detectBookingPromise(texto);
    expect(resultado.promises).toBe(true);
    expect(texto).toContain(resultado.match as string);
  });

  it("la negación adyacente exime, pero no la negación lejana", () => {
    expect(detectBookingPromise("No te la reservo yo.").promises).toBe(false);
    expect(
      detectBookingPromise("No te preocupes, te la reservo yo.").promises
    ).toBe(true);
  });

  it("describir el proceso exime, pero solo dentro de la misma oración", () => {
    expect(
      detectBookingPromise("La reserva se hace online y queda confirmada.").promises
    ).toBe(false);
    expect(
      detectBookingPromise("Se paga online. Queda reservada.").promises
    ).toBe(true);
    expect(
      detectBookingPromise(
        "En el sitio ves todo; ya queda reservada a tu nombre."
      ).promises
    ).toBe(true);
    expect(
      detectBookingPromise(
        "La reserva se completa en el sitio, igual te la reservo yo."
      ).promises
    ).toBe(true);
  });

  it("el condicional exime solo al estado, nunca al compromiso", () => {
    expect(
      detectBookingPromise("Queda reservada cuando pagás en el sitio.").promises
    ).toBe(false);
    expect(
      detectBookingPromise("Te la reservo cuando pagues en el sitio.").promises
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reemplazo: lo que usa el pipeline
// ---------------------------------------------------------------------------

describe("stripBookingPromise", () => {
  it("deja intacto el texto limpio y no marca incidente", () => {
    const texto = "Para reservar entrá al enlace que te paso.";
    const resultado = stripBookingPromise(texto, { link: ENLACE });
    expect(resultado.replaced).toBe(false);
    expect(resultado.text).toBe(texto);
    expect(resultado.match).toBeNull();
  });

  it("reemplaza el texto entero por la frase segura con el enlace", () => {
    const resultado = stripBookingPromise("Dale, te la reservo para el finde.", {
      link: ENLACE,
    });
    expect(resultado.replaced).toBe(true);
    expect(resultado.match).toContain("te la reservo");
    expect(resultado.text).not.toContain("te la reservo");
    expect(resultado.text).toContain(ENLACE);
    expect(resultado.text).toContain("se completa en el sitio");
  });

  it("sin enlace válido responde igual, sin inventar una URL", () => {
    for (const link of [null, undefined, "", "javascript:alert(1)", "http://x.test"]) {
      const resultado = stripBookingPromise("Te la reservo.", { link });
      expect(resultado.replaced).toBe(true);
      expect(resultado.text).not.toContain("http");
      expect(resultado.text).toContain("se completa en el sitio");
    }
  });

  it("acepta el enlace https y rechaza el que trae espacios", () => {
    expect(safeBookingReply(`${ENLACE} otra cosa`)).not.toContain(ENLACE);
    expect(safeBookingReply(ENLACE)).toContain(ENLACE);
  });

  it("la frase segura NO dispara la propia guarda (sin bucle de reemplazo)", () => {
    expect(detectBookingPromise(safeBookingReply(ENLACE)).promises).toBe(false);
    expect(detectBookingPromise(safeBookingReply(null)).promises).toBe(false);
    const dosVueltas = stripBookingPromise(
      stripBookingPromise("Te la reservo.", { link: ENLACE }).text,
      { link: ENLACE }
    );
    expect(dosVueltas.replaced).toBe(false);
  });

  it("las frases prohibidas del guion E2E nunca sobreviven", () => {
    const prohibidas = [
      "te la reservo",
      "queda tomada",
      "te lo dejo guardado",
      "seña por transferencia",
    ];
    for (const frase of prohibidas) {
      const resultado = stripBookingPromise(`Bueno, ${frase} y listo.`, {
        link: ENLACE,
      });
      expect(resultado.replaced, frase).toBe(true);
      expect(resultado.text.toLowerCase()).not.toContain(frase);
    }
  });
});
