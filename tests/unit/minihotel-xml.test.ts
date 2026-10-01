import { describe, expect, it } from "vitest";
import {
  attr,
  childElements,
  childText,
  decodeEntities,
  findAll,
  findFirst,
  parseXml,
  textOf,
  XmlParseError,
} from "@/lib/minihotel/xml";

/**
 * 028 — Parser XML acotado. Lo que importa: lee lo que manda MiniHotel,
 * tolera sus rarezas documentadas y RECHAZA lo peligroso (DTD) y lo roto.
 */

describe("parseXml — lo que manda MiniHotel", () => {
  it("lee elementos, atributos, texto y la declaración XML", () => {
    const doc = parseXml(
      '<?xml version="1.0" encoding="UTF-8"?>\n<AvailRaters><Hotel id="sandbox" Name_h="Hotel de Prueba" Currency="USD" /><RoomType id="DBL"><price board="BB" value="352.50" /></RoomType></AvailRaters>'
    );
    const root = findFirst(doc, "AvailRaters");
    expect(root).not.toBeNull();
    expect(attr(findFirst(doc, "Hotel"), "Currency")).toBe("USD");
    expect(attr(findFirst(doc, "price"), "value")).toBe("352.50");
    expect(childElements(root, "RoomType")).toHaveLength(1);
  });

  it("búsquedas y atributos insensibles a mayúsculas (la doc mezcla price/Price)", () => {
    const doc = parseXml('<Root><Price BOARD="HB" /></Root>');
    expect(findAll(doc, "price")).toHaveLength(1);
    expect(attr(findFirst(doc, "PRICE"), "board")).toBe("HB");
  });

  it("decodifica entidades predefinidas y numéricas en texto y atributos", () => {
    const doc = parseXml('<A n="Caba&#241;a &amp; Spa"><B>Habitaci&#xF3;n &lt;doble&gt;</B></A>');
    expect(attr(findFirst(doc, "A"), "n")).toBe("Cabaña & Spa");
    expect(childText(findFirst(doc, "A"), "B")).toBe("Habitación <doble>");
  });

  it("acepta CDATA, comentarios y comillas simples", () => {
    const doc = parseXml("<A x='1'><!-- nota --><B><![CDATA[a < b]]></B></A>");
    expect(attr(findFirst(doc, "A"), "x")).toBe("1");
    expect(textOf(findFirst(doc, "B"))).toBe("a < b");
  });

  it("tolera VARIAS raíces (la respuesta por área de la doc trae dos <AvailRaters>)", () => {
    const doc = parseXml("<AvailRaters><Hotel id='a'/></AvailRaters><AvailRaters><Hotel id='b'/></AvailRaters>");
    expect(findAll(doc, "AvailRaters")).toHaveLength(2);
  });

  it("un `>` dentro de un atributo no corta la etiqueta", () => {
    const doc = parseXml('<A desc="a > b" />');
    expect(attr(findFirst(doc, "A"), "desc")).toBe("a > b");
  });

  it("vacío y espacios → null en attr/textOf", () => {
    const doc = parseXml('<A x="  "><B>   </B></A>');
    expect(attr(findFirst(doc, "A"), "x")).toBeNull();
    expect(textOf(findFirst(doc, "B"))).toBeNull();
  });
});

describe("parseXml — lo que se rechaza", () => {
  it("DOCTYPE/ENTITY: cierra la expansión de entidades", () => {
    expect(() =>
      parseXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')
    ).toThrow(XmlParseError);
  });

  it("etiquetas mal anidadas o sin cerrar", () => {
    expect(() => parseXml("<A><B></A></B>")).toThrow(XmlParseError);
    expect(() => parseXml("<A><B></B>")).toThrow(XmlParseError);
    expect(() => parseXml("<A")).toThrow(XmlParseError);
  });

  it("topes de nodos y de profundidad", () => {
    const many = `<R>${"<x/>".repeat(20)}</R>`;
    expect(() => parseXml(many, { maxNodes: 10, maxDepth: 64, maxInputChars: 1e6 })).toThrow(
      XmlParseError
    );
    const deep = `${"<a>".repeat(10)}${"</a>".repeat(10)}`;
    expect(() => parseXml(deep, { maxNodes: 100, maxDepth: 5, maxInputChars: 1e6 })).toThrow(
      XmlParseError
    );
  });

  it("nombres de etiqueta inválidos", () => {
    expect(() => parseXml("<1abc/>")).toThrow(XmlParseError);
  });
});

describe("decodeEntities", () => {
  it("deja intactas las entidades desconocidas y los códigos inválidos", () => {
    expect(decodeEntities("a &nbsp; b &#0; c &#xD800;")).toBe("a &nbsp; b &#0; c &#xD800;");
  });
});
