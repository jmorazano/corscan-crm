import { describe, expect, it } from "vitest";
import { durationDays, mergeRanges, parseIcal, unfoldLines } from "@/lib/ical/parse";

/**
 * 051: parser acotado del calendario que exporta Airbnb. Los feeds salen
 * del formato REAL bajado el 11-nov-2026 (anonimizado).
 */

const TZ = "America/Argentina/Cordoba";

const AIRBNB_BLOCK = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTSTAMP:20261111T194057Z",
  "DTSTART;VALUE=DATE:20261111",
  "DTEND;VALUE=DATE:20261118",
  "SUMMARY:Airbnb (Not available)",
  "UID:7f662ec65913-4e9c38edd9fe3c0bdf16b4dad77c1241@airbnb.com",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const AIRBNB_RESERVATION = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261205",
  "DTSTART;VALUE=DATE:20261201",
  "UID:1418fb94e984-abc@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de",
  " tails/HMXXXXXXX\\nPhone Number (Last 4 Digits): 4321",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261205",
  "DTEND;VALUE=DATE:20261208",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

describe("parseIcal", () => {
  it("lee el bloqueo de Airbnb con DTEND exclusivo", () => {
    const r = parseIcal(AIRBNB_BLOCK, { tz: TZ });
    expect(r).toEqual({
      ok: true,
      busy: [{ from: "2026-11-11", to: "2026-11-18" }],
      horizonTo: "2026-11-18",
      events: 1,
    });
  });

  it("fusiona reservas contiguas y descarta TODO el texto del huésped", () => {
    const r = parseIcal(AIRBNB_RESERVATION, { tz: TZ });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.busy).toEqual([{ from: "2026-12-01", to: "2026-12-08" }]);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("4321");
    expect(serialized).not.toContain("Reserv");
    expect(serialized).not.toContain("HMXXXX");
  });

  it("calendario vacío = todo libre", () => {
    const r = parseIcal("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n", { tz: TZ });
    expect(r).toEqual({ ok: true, busy: [], horizonTo: null, events: 0 });
  });

  it("fecha-hora UTC se pasa al día de la empresa; TZID se toma tal cual", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      // 02:00 UTC del 10 = 23:00 del 9 en Córdoba
      "DTSTART:20261210T020000Z",
      "DTEND:20261212T020000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;TZID=America/Argentina/Cordoba:20261220T140000",
      "DTEND;TZID=America/Argentina/Cordoba:20261222T100000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const r = parseIcal(text, { tz: TZ });
    expect(r.ok && r.busy).toEqual([
      { from: "2026-12-09", to: "2026-12-11" },
      { from: "2026-12-20", to: "2026-12-22" },
    ]);
  });

  it("DURATION sin DTEND, evento sin fin = una noche, CANCELLED y TRANSPARENT se ignoran", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261001",
      "DURATION:P3D",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261010",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261020",
      "DTEND;VALUE=DATE:20261025",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "DTSTART;VALUE=DATE:20261026",
      "DTEND;VALUE=DATE:20261027",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const r = parseIcal(text, { tz: TZ });
    expect(r.ok && r.busy).toEqual([
      { from: "2026-10-01", to: "2026-10-04" },
      { from: "2026-10-10", to: "2026-10-11" },
    ]);
  });

  it("un VALARM dentro del evento no lo rompe", () => {
    const text =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nBEGIN:VALARM\nDTSTART:20991231T000000Z\nEND:VALARM\nDTEND;VALUE=DATE:20261102\nEND:VEVENT\nEND:VCALENDAR";
    const r = parseIcal(text, { tz: TZ });
    expect(r.ok && r.busy).toEqual([{ from: "2026-11-01", to: "2026-11-02" }]);
  });

  it("RRULE → no soportado (no se adivina)", () => {
    const text =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nRRULE:FREQ=WEEKLY\nEND:VEVENT\nEND:VCALENDAR";
    expect(parseIcal(text, { tz: TZ })).toEqual({ ok: false, code: "unsupported" });
  });

  it("HTML, JSON o basura → not_calendar", () => {
    for (const text of ["<!doctype html><html>login</html>", '{"error":1}', "", "BEGIN:VCALENDAR\nBEGIN:VEVENT\n"]) {
      expect(parseIcal(text, { tz: TZ })).toEqual({ ok: false, code: "not_calendar" });
    }
  });

  it("tope de eventos", () => {
    const ev = "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nEND:VEVENT\n";
    const text = `BEGIN:VCALENDAR\n${ev.repeat(5)}END:VCALENDAR`;
    expect(parseIcal(text, { tz: TZ, maxEvents: 4 })).toEqual({ ok: false, code: "too_many_events" });
  });

  it("un bloqueo eterno se recorta", () => {
    const text =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;VALUE=DATE:20261101\nDTEND;VALUE=DATE:21001101\nEND:VEVENT\nEND:VCALENDAR";
    const r = parseIcal(text, { tz: TZ });
    expect(r.ok && r.busy[0]!.to).toBe("2029-01-09");
  });
});

describe("piezas", () => {
  it("desplegado RFC 5545", () => {
    expect(unfoldLines("A:uno\r\n dos\r\n\ttres\nB:x")).toEqual(["A:unodostres", "B:x"]);
  });
  it("duraciones", () => {
    expect(durationDays("P3D")).toBe(3);
    expect(durationDays("P1W")).toBe(7);
    expect(durationDays("PT24H")).toBe(1);
    expect(durationDays("PT25H")).toBe(2);
    expect(durationDays("nada")).toBeNull();
  });
  it("fusión de rangos que se tocan y se pisan", () => {
    expect(
      mergeRanges([
        { from: "2026-01-05", to: "2026-01-07" },
        { from: "2026-01-01", to: "2026-01-03" },
        { from: "2026-01-03", to: "2026-01-04" },
        { from: "2026-01-06", to: "2026-01-10" },
      ])
    ).toEqual([
      { from: "2026-01-01", to: "2026-01-04" },
      { from: "2026-01-05", to: "2026-01-10" },
    ]);
  });
});
