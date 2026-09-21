import { describe, expect, it } from "vitest";
import { coercePatchForKind, KbError, kbSize, WARN_CHARS } from "@/server/kb/service";

/** 015 (D8): coherencia kind↔campos y tamaño del KB. */
describe("coercePatchForKind", () => {
  it("qa acepta question/answer y rechaza content", () => {
    expect(coercePatchForKind("qa", { answer: "nuevo" })).toEqual({ answer: "nuevo" });
    expect(() => coercePatchForKind("qa", { content: "x" })).toThrowError(KbError);
    try {
      coercePatchForKind("qa", { content: "x" });
    } catch (err) {
      expect((err as KbError).code).toBe("kind_mismatch");
    }
  });
  it("block acepta content y rechaza question/answer", () => {
    expect(coercePatchForKind("block", { content: "x" })).toEqual({ content: "x" });
    expect(() => coercePatchForKind("block", { question: "?" })).toThrowError(KbError);
  });
  it("patch vacío → invalid", () => {
    try {
      coercePatchForKind("qa", {});
      expect.fail("debía lanzar");
    } catch (err) {
      expect((err as KbError).code).toBe("invalid");
    }
  });
});

describe("kbSize", () => {
  it("vacío no avisa; grande avisa", () => {
    expect(kbSize([]).warning).toBe(false);
    const big = {
      id: "kb_1",
      organizationId: "o",
      kind: "block" as const,
      question: null,
      answer: null,
      content: "x".repeat(WARN_CHARS + 1),
      source: "manual" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const s = kbSize([big]);
    expect(s.warning).toBe(true);
    expect(s.warnAt).toBe(WARN_CHARS);
  });
});
