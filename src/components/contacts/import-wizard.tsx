"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { FileSpreadsheet, Upload } from "lucide-react";
import {
  detectColumns,
  extractRows,
  type ColumnMapping,
  type RawCell,
} from "@/lib/import-columns";
import { normalizeToWaId } from "@/lib/phone";
import { parseTagsCell } from "@/lib/tags";
import { Button } from "@/components/ui/button";

/**
 * Wizard de import de contactos (004, US1). El archivo se parsea ACÁ, en el
 * navegador — al server solo viaja JSON de filas (contrato
 * contacts-import.md). La vista previa usa la MISMA normalización que el
 * server (src/lib/phone.ts), así lo que se ve es lo que se importa.
 */

type PreviewRow = {
  fileRow: number;
  phone: string;
  name: string;
  tags: string[];
  notes: string;
  valid: boolean;
  reason?: string;
};

type Report = {
  created: number;
  updated: number;
  invalid: { index: number; phone?: string; reason: string }[];
};

type Step =
  | { kind: "pick"; error?: string }
  | { kind: "preview"; fileName: string; mapping: ColumnMapping; rows: PreviewRow[] }
  | { kind: "report"; report: Report };

const REASON_LABELS: Record<string, string> = {
  telefono_invalido: "teléfono inválido",
  telefono_vacio: "teléfono vacío",
  contacto_de_prueba: "contacto de prueba del Laboratorio",
  sin_columna_telefono: "no se encontró una columna de teléfono",
  sin_filas: "el archivo no tiene filas",
};

export function ImportWizard({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    let cells: RawCell[][];
    try {
      if (/\.csv$/i.test(file.name)) {
        cells = await new Promise<RawCell[][]>((resolve, reject) => {
          Papa.parse<string[]>(file, {
            complete: (r) => resolve(r.data as RawCell[][]),
            error: reject,
            skipEmptyLines: false,
          });
        });
      } else {
        // El tipo de celda de la lib incluye un raro `typeof Date`; para la
        // detección de columnas todo pasa por String() igual.
        cells = (await readSheet(file)) as RawCell[][];
      }
    } catch {
      setStep({
        kind: "pick",
        error:
          "No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.",
      });
      return;
    }

    const detection = detectColumns(cells);
    if (!detection.ok) {
      setStep({
        kind: "pick",
        error: `No se pudo interpretar el archivo: ${REASON_LABELS[detection.reason] ?? detection.reason}. Se esperan encabezados tipo "Teléfono", "Nombre", "Etiquetas", "Notas".`,
      });
      return;
    }

    const rows: PreviewRow[] = extractRows(cells, detection.mapping).map(
      (r) => {
        const normalized = normalizeToWaId(r.phone);
        return {
          fileRow: r.fileRow,
          phone: normalized.ok ? normalized.waId : r.phone,
          name: r.name,
          tags: parseTagsCell(r.tagsCell),
          notes: r.notes,
          valid: normalized.ok,
          reason: normalized.ok
            ? undefined
            : (REASON_LABELS[`telefono_${normalized.reason}`] ??
              "teléfono inválido"),
        };
      }
    );
    if (rows.length === 0) {
      setStep({ kind: "pick", error: "El archivo no tiene filas de datos." });
      return;
    }
    setConsent(false);
    setStep({ kind: "preview", fileName: file.name, mapping: detection.mapping, rows });
  }

  async function confirmImport(rows: PreviewRow[]) {
    setSubmitting(true);
    setSubmitError(null);
    const payload = {
      rows: rows
        .filter((r) => r.valid)
        .map((r) => ({
          phone: r.phone,
          name: r.name || undefined,
          tags: r.tags.length ? r.tags : undefined,
          notes: r.notes || undefined,
        })),
      consentDeclared: consent,
    };
    const res = await fetch("/api/contacts/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    setSubmitting(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSubmitError(
        data?.error?.message ?? "El import falló; no se guardó nada. Reintentá."
      );
      return;
    }
    const report = (await res.json()) as Report;
    // Las filas que el navegador ya marcó inválidas se suman al reporte para
    // que el operador vea el total real de su archivo.
    const clientInvalid = rows
      .filter((r) => !r.valid)
      .map((r) => ({
        index: r.fileRow,
        phone: r.phone || undefined,
        reason: r.reason ?? "teléfono inválido",
      }));
    setStep({
      kind: "report",
      report: { ...report, invalid: [...clientInvalid, ...report.invalid] },
    });
    onImported();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Importar contactos</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Excel (.xlsx) o CSV con encabezados: Teléfono (obligatorio), Nombre,
          Etiquetas, Notas. El archivo se procesa en tu navegador.
        </p>

        {step.kind === "pick" && (
          <div className="space-y-3">
            {step.error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {step.error}
              </p>
            )}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-sm text-muted-foreground hover:border-primary hover:text-foreground"
            >
              <FileSpreadsheet className="h-8 w-8" />
              Elegí tu archivo .xlsx o .csv
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {step.kind === "preview" && (
          <PreviewStep
            step={step}
            consent={consent}
            setConsent={setConsent}
            submitting={submitting}
            submitError={submitError}
            onConfirm={() => void confirmImport(step.rows)}
            onBack={() => setStep({ kind: "pick" })}
          />
        )}

        {step.kind === "report" && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <ReportStat label="Creados" value={step.report.created} />
              <ReportStat label="Actualizados" value={step.report.updated} />
              <ReportStat
                label="Rechazados"
                value={step.report.invalid.length}
                destructive={step.report.invalid.length > 0}
              />
            </div>
            {step.report.invalid.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border text-xs">
                <table className="w-full">
                  <tbody>
                    {step.report.invalid.map((r, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1 text-muted-foreground">
                          Fila {r.index}
                        </td>
                        <td className="px-2 py-1 font-mono">{r.phone ?? "—"}</td>
                        <td className="px-2 py-1">
                          {REASON_LABELS[r.reason] ?? r.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={onClose}>Listo</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewStep({
  step,
  consent,
  setConsent,
  submitting,
  submitError,
  onConfirm,
  onBack,
}: {
  step: Extract<Step, { kind: "preview" }>;
  consent: boolean;
  setConsent: (v: boolean) => void;
  submitting: boolean;
  submitError: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const valid = step.rows.filter((r) => r.valid);
  const invalid = step.rows.filter((r) => !r.valid);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">{step.fileName}</span>:{" "}
        <span className="text-primary">{valid.length} filas válidas</span>
        {invalid.length > 0 && (
          <span className="text-destructive"> · {invalid.length} inválidas</span>
        )}
      </p>
      <div className="max-h-56 overflow-y-auto rounded-md border text-xs">
        <table className="w-full">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-normal">Teléfono</th>
              <th className="px-2 py-1 font-normal">Nombre</th>
              <th className="px-2 py-1 font-normal">Etiquetas</th>
              <th className="px-2 py-1 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody>
            {step.rows.slice(0, 50).map((r) => (
              <tr key={r.fileRow} className="border-t">
                <td className="px-2 py-1 font-mono">{r.phone}</td>
                <td className="px-2 py-1">{r.name || "—"}</td>
                <td className="px-2 py-1">{r.tags.join(", ") || "—"}</td>
                <td className="px-2 py-1">
                  {r.valid ? (
                    <span className="text-primary">ok</span>
                  ) : (
                    <span className="text-destructive">{r.reason}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {step.rows.length > 50 && (
          <p className="px-2 py-1 text-muted-foreground">
            … y {step.rows.length - 50} filas más
          </p>
        )}
      </div>
      <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          Declaro que estos contactos dieron su consentimiento para recibir
          mensajes de mi negocio por WhatsApp. Sin esta declaración el import
          no procede.
        </span>
      </label>
      {submitError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack} disabled={submitting}>
          Elegir otro archivo
        </Button>
        <Button
          disabled={!consent || submitting || valid.length === 0}
          onClick={onConfirm}
        >
          <Upload className="mr-1.5 h-4 w-4" />
          {submitting
            ? "Importando…"
            : `Importar ${valid.length} contacto(s)`}
        </Button>
      </div>
    </div>
  );
}

function ReportStat({
  label,
  value,
  destructive,
}: {
  label: string;
  value: number;
  destructive?: boolean;
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p
        className={`text-lg font-semibold ${destructive ? "text-destructive" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
