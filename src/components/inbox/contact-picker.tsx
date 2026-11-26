"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Contact, Loader2, Plus, Search, X } from "lucide-react";
import { CONTACT_CARD_MAX, cleanCardPhone } from "@/lib/contact-card";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Dialog } from "@/components/ui/dialog";

const JSON_HEADERS = { "content-type": "application/json" };

type CrmContact = {
  id: string;
  name: string;
  phone: string;
  channel: "whatsapp" | "instagram";
  isTest: boolean;
};

type Picked =
  | { key: string; kind: "crm"; id: string; name: string; phone: string }
  | { key: string; kind: "manual"; name: string; phone: string };

/**
 * 054: «Enviar contacto». Se eligen contactos del CRM (los de WhatsApp, con
 * teléfono real) o se escribe uno a mano — el encargado, el electricista:
 * gente que no es cliente y no está cargada. WhatsApp los lleva como
 * tarjeta; Instagram, como texto (se avisa antes de enviar).
 */
export function ContactPicker({
  open,
  conversationId,
  channel,
  recipientName,
  onClose,
  onSent,
}: {
  open: boolean;
  conversationId: string;
  channel: "whatsapp" | "instagram";
  recipientName: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CrmContact[] | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked([]);
    setManualOpen(false);
    setManualName("");
    setManualPhone("");
    setError(null);
    setSending(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const timer = window.setTimeout(
      async () => {
        const qs = new URLSearchParams({ limit: "30" });
        if (q.trim()) qs.set("q", q.trim());
        const res = await fetch(`/api/contacts?${qs}`).catch(() => null);
        if (seq !== seqRef.current) return;
        if (!res?.ok) {
          setRows([]);
          return;
        }
        const data = (await res.json()) as { contacts: CrmContact[] };
        if (seq !== seqRef.current) return;
        // Instagram guarda un teléfono sintético: no hay número que compartir.
        setRows(
          data.contacts.filter(
            (c) => c.channel === "whatsapp" && !c.isTest && /^\d{7,15}$/.test(c.phone)
          )
        );
      },
      q.trim() ? 250 : 0
    );
    return () => window.clearTimeout(timer);
  }, [open, q]);

  const full = picked.length >= CONTACT_CARD_MAX;

  function toggleCrm(c: CrmContact) {
    setError(null);
    setPicked((prev) => {
      const key = `crm:${c.id}`;
      if (prev.some((p) => p.key === key)) return prev.filter((p) => p.key !== key);
      if (prev.length >= CONTACT_CARD_MAX) return prev;
      return [...prev, { key, kind: "crm", id: c.id, name: c.name, phone: c.phone }];
    });
  }

  function addManual() {
    const name = manualName.trim();
    const phone = cleanCardPhone(manualPhone);
    if (!name) {
      setError("Escribí el nombre del contacto");
      return;
    }
    if (!phone) {
      setError("Escribí un teléfono válido, con característica (por ejemplo 351 555 1234)");
      return;
    }
    if (full) return;
    setError(null);
    setPicked((prev) => [
      ...prev,
      { key: `manual:${phone}:${prev.length}`, kind: "manual", name, phone },
    ]);
    setManualName("");
    setManualPhone("");
    setManualOpen(false);
  }

  async function submit() {
    if (picked.length === 0 || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/messages/contacts`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        contactIds: picked.flatMap((p) => (p.kind === "crm" ? [p.id] : [])),
        manual: picked.flatMap((p) => (p.kind === "manual" ? [{ name: p.name, phone: p.phone }] : [])),
      }),
    }).catch(() => null);
    setSending(false);
    if (!res) {
      setError("Sin conexión con el servidor");
      return;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo enviar el contacto");
      return;
    }
    onSent();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enviar contacto"
      description={`A ${recipientName}`}
      size="md"
      testId="contact-picker"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-text-3">
            {picked.length === 0
              ? `Hasta ${CONTACT_CARD_MAX} contactos`
              : `${picked.length} ${picked.length === 1 ? "contacto" : "contactos"}`}
          </span>
          <button
            type="button"
            disabled={picked.length === 0 || sending}
            onClick={() => void submit()}
            data-testid="contact-picker-send"
            className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.8} />
            ) : (
              <Contact className="h-4 w-4" strokeWidth={1.8} />
            )}
            {sending ? "Enviando…" : "Enviar"}
          </button>
        </div>
      }
    >
      {channel === "instagram" && (
        <p
          data-testid="contact-picker-instagram"
          className="mb-2.5 rounded-md border border-[#ece2cf] bg-[#faf7f0] px-3 py-2 text-xs text-[#8a6d3b]"
        >
          Instagram no tiene tarjetas de contacto: se envía como un mensaje de texto con el
          nombre y el teléfono.
        </p>
      )}

      {picked.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5" data-testid="contact-picker-picked">
          {picked.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPicked((prev) => prev.filter((x) => x.key !== p.key))}
              title="Quitar"
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-brand-soft bg-brand-tint py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-brand-text"
            >
              <span className="truncate">{p.name}</span>
              <X className="h-3 w-3 shrink-0" strokeWidth={2} />
            </button>
          ))}
        </div>
      )}

      {manualOpen ? (
        <div className="rounded-md border p-3" data-testid="contact-manual-form">
          <p className="mb-2 text-xs font-medium text-text-2">Otro contacto</p>
          <div className="flex flex-col gap-2 md:flex-row">
            <input
              autoFocus
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Nombre"
              aria-label="Nombre del contacto"
              maxLength={120}
              data-testid="contact-manual-name"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
            <input
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="Teléfono (351 555 1234)"
              aria-label="Teléfono del contacto"
              inputMode="tel"
              maxLength={40}
              data-testid="contact-manual-phone"
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setManualOpen(false);
                setError(null);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-text-2 hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={addManual}
              data-testid="contact-manual-add"
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Agregar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              strokeWidth={1.7}
            />
            <input
              data-autofocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar en tus contactos"
              aria-label="Buscar en tus contactos"
              data-testid="contact-picker-search"
              className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </div>
          <button
            type="button"
            disabled={full}
            onClick={() => {
              setManualOpen(true);
              setError(null);
            }}
            data-testid="contact-manual-open"
            title="Escribir el nombre y el teléfono de alguien que no está cargado"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={1.8} /> Otro
          </button>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert" data-testid="contact-picker-error">
          {error}
        </p>
      )}

      <ul className="-mx-1 mt-2.5 flex max-h-[40dvh] min-h-[160px] flex-col overflow-y-auto md:max-h-[300px]">
        {rows === null ? (
          <li className="flex items-center justify-center gap-2 py-8 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.7} /> Cargando contactos…
          </li>
        ) : rows.length === 0 ? (
          <li className="py-8 text-center text-sm text-text-3" data-testid="contact-picker-empty">
            {q.trim()
              ? "Ningún contacto coincide. Con «Otro» podés escribirlo a mano."
              : "No hay contactos de WhatsApp cargados. Con «Otro» podés escribirlo a mano."}
          </li>
        ) : (
          rows.map((c) => {
            const checked = picked.some((p) => p.key === `crm:${c.id}`);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={sending || (full && !checked)}
                  onClick={() => toggleCrm(c)}
                  role="checkbox"
                  aria-checked={checked}
                  data-testid="contact-picker-row"
                  data-contact-id={c.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                    checked && "bg-brand-tint"
                  )}
                >
                  <ContactAvatar name={c.name} seed={c.id} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <span className="block truncate text-xs text-text-3">+{c.phone}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      checked ? "border-brand bg-brand text-white" : "border-border-strong"
                    )}
                  >
                    {checked && <Check className="h-3.5 w-3.5" strokeWidth={2.4} />}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Dialog>
  );
}
