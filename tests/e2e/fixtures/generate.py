#!/usr/bin/env python3
"""Genera los fixtures de import de contactos (contactos.xlsx + contactos.csv).

Se corre UNA vez y los archivos generados se commitean (son chicos y el guion
E2E us-cc-1 los usa tal cual). Requiere openpyxl (viene con muchas
instalaciones de Python; `pip install openpyxl` si falta).

Filas de prueba (mismas en ambos formatos):
  - 3 formatos argentinos del MISMO numero (deben converger a 5493516882200)
  - variantes validas con tags/notas
  - un duplicado interno exacto (la primera gana; la segunda cuenta updated)
  - un telefono invalido (letras) -> invalid con motivo
  - un telefono demasiado corto -> invalid
  - una fila sin nombre (valida: el nombre cae al telefono)
"""
import csv
import os
from openpyxl import Workbook

HERE = os.path.dirname(os.path.abspath(__file__))

HEADERS = ["Teléfono", "Nombre", "Etiquetas", "Notas"]
ROWS = [
    ["0351 15 688 2200", "Cliente Uno", "clientes-2025", "formato local"],
    ["+54 351 688 2200", "Cliente Uno bis", "clientes-2025", "formato E.164 sin 9"],
    ["5493516882200", "Cliente Uno tris", "vip", "formato wa_id"],
    ["+54 9 351 688 2201", "Cliente Dos", "clientes-2025,vip", "dos etiquetas"],
    ["549351688 2202", "Cliente Tres", "", "sin etiquetas"],
    ["+54 9 351 688 2203", "", "clientes-2025", "sin nombre"],
    ["+54 9 351 688 2201", "Cliente Dos duplicado", "otra-tag", "duplicado interno"],
    ["ABC-NO-ES-TELEFONO", "Fila Rota", "", "telefono invalido"],
    ["123", "Fila Corta", "", "demasiado corto"],
    ["+54 9 351 688 2204", "Cliente Cuatro", "clientes-2025", ""],
    ["+54 9 351 688 2205", "Cliente Cinco", "vip", "nota cinco"],
    ["+54 9 351 688 2206", "Cliente Seis", "clientes-2025", ""],
]


def main() -> None:
    csv_path = os.path.join(HERE, "contactos.csv")
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADERS)
        w.writerows(ROWS)

    wb = Workbook()
    ws = wb.active
    ws.title = "Contactos"
    ws.append(HEADERS)
    for row in ROWS:
        ws.append(row)
    xlsx_path = os.path.join(HERE, "contactos.xlsx")
    wb.save(xlsx_path)

    print(f"OK {csv_path}")
    print(f"OK {xlsx_path}")


if __name__ == "__main__":
    main()
