import { describe, expect, it } from "vitest";
import { shouldRefreshToken } from "@/server/instagram/integration";
import { friendlyInstagramError } from "@/server/instagram/send";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-25T12:00:00Z");
const row = (expiresInDays: number, refreshedDaysAgo: number, status = "connected") => ({
  tokenExpiresAt: new Date(now.getTime() + expiresInDays * DAY),
  tokenRefreshedAt: new Date(now.getTime() - refreshedDaysAgo * DAY),
  status,
});

describe("shouldRefreshToken (023)", () => {
  it("renueva cuando le quedan < 15 días y tiene ≥ 24 h", () => {
    expect(shouldRefreshToken(row(10, 50), now)).toBe(true);
    expect(shouldRefreshToken(row(20, 40), now)).toBe(false);
  });
  it("no renueva un token recién emitido, vencido o en reconexión", () => {
    expect(shouldRefreshToken(row(10, 0.5), now)).toBe(false);
    expect(shouldRefreshToken(row(-1, 61), now)).toBe(false);
    expect(shouldRefreshToken(row(10, 50, "reconnect_required"), now)).toBe(false);
  });
});

describe("friendlyInstagramError", () => {
  it("traduce los motivos frecuentes", () => {
    expect(friendlyInstagramError({ code: 551, subcode: null, message: "x" })).toMatch(/no está disponible/);
    expect(friendlyInstagramError({ code: 10, subcode: 2018278, message: "x" })).toMatch(/fuera de la ventana/);
    expect(friendlyInstagramError({ code: 1, subcode: null, message: "raro" })).toBe(
      "Instagram rechazó el envío: raro"
    );
  });
});
