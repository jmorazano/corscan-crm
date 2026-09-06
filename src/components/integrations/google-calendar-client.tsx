"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, CalendarDays, Link2, Trash2, Unplug } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Página de la integración Google Calendar (US1/US2/US4): conexión OAuth,
 * calendario + zona, reglas de turnos con vista previa de huecos y lista de
 * turnos agendados desde el CRM. Solo el propietario administra (FR-002);
 * jamás se muestra ni se pide un token.
 */

type WeekdayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";
type WeeklyHours = Record<WeekdayKey, [string, string][]>;

type Integration = {
  accountEmail: string | null;
  calendarId: string;
  calendarName: string | null;
  timezone: string;
  status: "connected" | "reconnect_required";
  agentBookingEnabled: boolean;
  slotMinutes: number;
  bufferMinutes: number;
  minLeadHours: number;
  horizonDays: number;
  weeklyHours: WeeklyHours;
  bookingInstructions: string | null;
  connectedAt: string;
};

type Response_ = { available: boolean; integration: Integration | null; canManage: boolean };

type SlotView = { start: string; end: string; local: string; label: string };

type Appointment = {
  id: string;
  contactName: string;
  contactPhone: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: "confirmed" | "cancelled";
  createdBy: "agent" | "user";
  note: string | null;
};

const DAYS: { key: WeekdayKey; label: string }[] = [
  { key: "1", label: "Lunes" },
  { key: "2", label: "Martes" },
  { key: "3", label: "Miércoles" },
  { key: "4", label: "Jueves" },
  { key: "5", label: "Viernes" },
  { key: "6", label: "Sábado" },
  { key: "0", label: "Domingo" },
];

const TIMEZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Montevideo",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/New_York",
  "Europe/Madrid",
  "UTC",
];

const ERROR_TEXT: Record<string, string> = {
  cancelled: "Cancelaste la autorización en Google. No se conectó nada.",
  state: "La autorización no coincide con tu sesión. Volvé a intentar desde este botón.",
  exchange: "Google no completó la autorización. Revisá la configuración de la app e intentá de nuevo.",
  forbidden: "Solo el propietario puede conectar la integración.",
};

export function GoogleCalendarClient() {
  const params = useSearchParams();
  const [data, setData] = useState<Response_ | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/google-calendar").catch(() => null);
    if (!res?.ok) return;
    setData((await res.json()) as Response_);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (params.get("connected") === "1") setNotice("Google Calendar conectado.");
    const e = params.get("error");
    if (e) setError(ERROR_TEXT[e] ?? "No se pudo conectar.");
  }, [params]);

  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      {notice && (
        <p className="rounded-md border border-[#d8e8dd] bg-[#eff7f1] px-3 py-2 text-sm text-[#3f6b52]" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]" role="alert">
          {error}
        </p>
      )}
      <ConnectionCard data={data} onChanged={refetch} onError={setError} onNotice={setNotice} />
      {data.integration && data.integration.status === "connected" && (
        <>
          <RulesCard data={data} onChanged={refetch} onError={setError} onNotice={setNotice} />
          <AvailabilityPreview integration={data.integration} />
          <AppointmentsCard />
        </>
      )}
    </div>
  );
}

/* ---------------- Conexión ---------------- */

function ConnectionCard({
  data,
  onChanged,
  onError,
  onNotice,
}: {
  data: Response_;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const { available, integration, canManage } = data;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function disconnect() {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/google-calendar", { method: "DELETE" }).catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      onError("No se pudo desconectar.");
      return;
    }
    onNotice("Google Calendar desconectado. El agente ya no ofrece turnos.");
    await onChanged();
  }

  return (
    <Card data-testid="gc-connection">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-brand" strokeWidth={1.7} />
            Conexión
          </CardTitle>
          {!available ? (
            <Badge variant="secondary">No habilitada</Badge>
          ) : !integration ? (
            <Badge variant="secondary">No conectada</Badge>
          ) : integration.status === "reconnect_required" ? (
            <Badge variant="warning">Requiere reconexión</Badge>
          ) : (
            <Badge variant="success">Conectada</Badge>
          )}
        </div>
        <CardDescription>
          {!available
            ? "El operador de esta instancia todavía no habilitó la integración con Google (faltan las credenciales de la app de Google en el entorno). Pedile que siga docs/integraciones/google-calendar-gcp.md."
            : integration
              ? `Cuenta: ${integration.accountEmail ?? "(sin email)"} · Calendario: ${integration.calendarName ?? integration.calendarId}`
              : "Conectá la cuenta de Google del negocio. Solo pedimos permiso para ver la ocupación de tus calendarios y crear eventos."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 px-5 pb-5">
        {available && canManage && (
          <>
            {(!integration || integration.status === "reconnect_required") && (
              <a href="/api/integrations/google-calendar/connect" data-testid="gc-connect">
                <Button>
                  <Link2 className="h-4 w-4" strokeWidth={1.7} />
                  {integration ? "Reconectar con Google" : "Conectar con Google"}
                </Button>
              </a>
            )}
            {integration && !confirming && (
              <Button variant="outline" onClick={() => setConfirming(true)} data-testid="gc-disconnect">
                <Unplug className="h-4 w-4" strokeWidth={1.7} />
                Desconectar
              </Button>
            )}
            {integration && confirming && (
              <span className="flex items-center gap-2 text-sm">
                ¿Desconectar? El CRM olvida las credenciales y el agente deja de ofrecer turnos.
                <Button variant="destructive" size="sm" disabled={busy} onClick={disconnect} data-testid="gc-disconnect-confirm">
                  Sí, desconectar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
              </span>
            )}
          </>
        )}
        {available && !canManage && (
          <p className="text-xs text-muted-foreground">Solo el propietario puede conectar, desconectar o editar reglas.</p>
        )}
        {integration?.status === "reconnect_required" && (
          <p className="w-full text-xs text-[#8a6d3b]">
            Google rechazó la credencial guardada (revocada o caducada). Hasta reconectar, el agente
            no ofrece turnos y deriva al equipo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/* ---------------- Reglas ---------------- */

function RulesCard({
  data,
  onChanged,
  onError,
  onNotice,
}: {
  data: Response_;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const integration = data.integration!;
  const canManage = data.canManage;
  const [calendars, setCalendars] = useState<{ id: string; summary: string; primary: boolean }[] | null>(null);
  const [calendarId, setCalendarId] = useState(integration.calendarId);
  const [timezone, setTimezone] = useState(integration.timezone);
  const [agentBookingEnabled, setAgentBookingEnabled] = useState(integration.agentBookingEnabled);
  const [slotMinutes, setSlotMinutes] = useState(integration.slotMinutes);
  const [bufferMinutes, setBufferMinutes] = useState(integration.bufferMinutes);
  const [minLeadHours, setMinLeadHours] = useState(integration.minLeadHours);
  const [horizonDays, setHorizonDays] = useState(integration.horizonDays);
  const [weeklyHours, setWeeklyHours] = useState<WeeklyHours>(integration.weeklyHours);
  const [instructions, setInstructions] = useState(integration.bookingInstructions ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCalendarId(integration.calendarId);
    setTimezone(integration.timezone);
    setAgentBookingEnabled(integration.agentBookingEnabled);
    setSlotMinutes(integration.slotMinutes);
    setBufferMinutes(integration.bufferMinutes);
    setMinLeadHours(integration.minLeadHours);
    setHorizonDays(integration.horizonDays);
    setWeeklyHours(integration.weeklyHours);
    setInstructions(integration.bookingInstructions ?? "");
  }, [integration]);

  const [calendarsError, setCalendarsError] = useState<string | null>(null);
  const [calendarsLoading, setCalendarsLoading] = useState(false);

  // Lista VIVA de la cuenta (con ocultos y paginada). Un calendario creado
  // después de abrir la página aparece con "Actualizar lista".
  const loadCalendars = useCallback(async () => {
    setCalendarsLoading(true);
    setCalendarsError(null);
    const res = await fetch("/api/integrations/google-calendar/calendars").catch(() => null);
    setCalendarsLoading(false);
    if (!res) {
      setCalendarsError("No se pudo consultar los calendarios.");
      setCalendars([]);
      return;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setCalendarsError(j?.error?.message ?? "No se pudo consultar los calendarios.");
      setCalendars([]);
      return;
    }
    const d = (await res.json()) as { calendars: { id: string; summary: string; primary: boolean }[] };
    setCalendars(d.calendars);
  }, []);

  useEffect(() => {
    void loadCalendars();
  }, [loadCalendars]);

  const timezoneOptions = useMemo(
    () => (TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]),
    [timezone]
  );

  function updateRange(day: WeekdayKey, idx: number, pos: 0 | 1, value: string) {
    setWeeklyHours((prev) => {
      const ranges = prev[day].map((r) => [...r] as [string, string]);
      ranges[idx]![pos] = value;
      return { ...prev, [day]: ranges };
    });
  }
  function addRange(day: WeekdayKey) {
    setWeeklyHours((prev) => ({ ...prev, [day]: [...prev[day], ["09:00", "13:00"]] }));
  }
  function removeRange(day: WeekdayKey, idx: number) {
    setWeeklyHours((prev) => ({ ...prev, [day]: prev[day].filter((_, i) => i !== idx) }));
  }

  async function save() {
    setSaving(true);
    onError(null);
    onNotice(null);
    const body = {
      calendarId,
      timezone,
      agentBookingEnabled,
      slotMinutes,
      bufferMinutes,
      minLeadHours,
      horizonDays,
      weeklyHours,
      bookingInstructions: instructions.trim() ? instructions.trim() : null,
    };
    const res = await fetch("/api/integrations/google-calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setSaving(false);
    if (!res) {
      onError("No se pudo guardar.");
      return;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      onError(j?.error?.message ?? "No se pudo guardar.");
      return;
    }
    onNotice("Reglas guardadas.");
    await onChanged();
  }

  return (
    <Card data-testid="gc-rules">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-brand" strokeWidth={1.7} />
          Reglas de turnos
        </CardTitle>
        <CardDescription>
          Con estas reglas el agente calcula los horarios libres (descontando lo que ya está
          ocupado en el calendario) y agenda solo dentro de ellas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-5 pb-5">
        <fieldset disabled={!canManage} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="gc-calendar">Calendario destino</Label>
                <button
                  type="button"
                  className="text-xs text-brand-text hover:underline disabled:opacity-50"
                  onClick={() => void loadCalendars()}
                  disabled={calendarsLoading}
                  data-testid="gc-calendars-refresh"
                >
                  {calendarsLoading ? "Actualizando…" : "Actualizar lista"}
                </button>
              </div>
              <select
                id="gc-calendar"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
              >
                {!(calendars ?? []).some((c) => c.id === calendarId) && (
                  <option value={calendarId}>{integration.calendarName ?? calendarId}</option>
                )}
                {(calendars ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.summary}
                    {c.primary ? " (principal)" : ""}
                  </option>
                ))}
              </select>
              {calendarsError && <p className="text-xs text-[#a2504c]">{calendarsError}</p>}
              {!calendarsError && calendars !== null && (
                <p className="text-xs text-muted-foreground">
                  {calendars.length} calendario{calendars.length === 1 ? "" : "s"} con permiso de
                  escritura en {integration.accountEmail ?? "la cuenta conectada"}. ¿Falta uno? Creá o
                  compartilo con esa cuenta y pulsá &quot;Actualizar lista&quot;.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gc-tz">Zona horaria del negocio</Label>
              <select
                id="gc-tz"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Horarios de atención</Label>
            <div className="space-y-2 rounded-md border p-3">
              {DAYS.map((d) => (
                <div key={d.key} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`gc-day-${d.key}`}>
                  <span className="w-20 shrink-0 font-medium">{d.label}</span>
                  {weeklyHours[d.key].length === 0 && (
                    <span className="text-xs text-muted-foreground">cerrado</span>
                  )}
                  {weeklyHours[d.key].map((r, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <Input
                        type="time"
                        className="h-8 w-28"
                        value={r[0]}
                        aria-label={`${d.label} desde`}
                        onChange={(e) => updateRange(d.key, i, 0, e.target.value)}
                      />
                      <span>–</span>
                      <Input
                        type="time"
                        className="h-8 w-28"
                        value={r[1]}
                        aria-label={`${d.label} hasta`}
                        onChange={(e) => updateRange(d.key, i, 1, e.target.value)}
                      />
                      {canManage && (
                        <button
                          type="button"
                          className="rounded p-1 text-text-3 hover:text-foreground"
                          aria-label={`Quitar franja de ${d.label}`}
                          onClick={() => removeRange(d.key, i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                        </button>
                      )}
                    </span>
                  ))}
                  {canManage && weeklyHours[d.key].length < 4 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => addRange(d.key)}>
                      + franja
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-4">
            <NumberField id="gc-slot" label="Duración (min)" value={slotMinutes} onChange={setSlotMinutes} min={5} max={480} />
            <NumberField id="gc-buffer" label="Margen (min)" value={bufferMinutes} onChange={setBufferMinutes} min={0} max={240} />
            <NumberField id="gc-lead" label="Anticipación (h)" value={minLeadHours} onChange={setMinLeadHours} min={0} max={168} />
            <NumberField id="gc-horizon" label="Horizonte (días)" value={horizonDays} onChange={setHorizonDays} min={1} max={90} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={agentBookingEnabled}
              onChange={(e) => setAgentBookingEnabled(e.target.checked)}
              data-testid="gc-agent-booking"
            />
            El agente puede agendar turnos por su cuenta (si está apagado, informa horarios y deriva al equipo)
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="gc-instructions">Instrucciones para el agente (opcional)</Label>
            <Textarea
              id="gc-instructions"
              rows={3}
              placeholder="Ej.: Pedí nombre completo y motivo de la consulta antes de agendar. No agendes primeras consultas los sábados."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        </fieldset>
        {canManage && (
          <Button onClick={save} disabled={saving} data-testid="gc-save">
            {saving ? "Guardando…" : "Guardar reglas"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

/* ---------------- Vista previa ---------------- */

function AvailabilityPreview({ integration }: { integration: Integration }) {
  const [slots, setSlots] = useState<SlotView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/integrations/google-calendar/availability?days=7").catch(() => null);
    if (!res) {
      setError("No se pudo consultar la disponibilidad.");
      return;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(j?.error?.message ?? "No se pudo consultar la disponibilidad.");
      setSlots([]);
      return;
    }
    const d = (await res.json()) as { slots: SlotView[] };
    setSlots(d.slots);
  }, []);

  useEffect(() => {
    void load();
  }, [load, integration]);

  const byDay = useMemo(() => {
    const map = new Map<string, SlotView[]>();
    for (const s of slots ?? []) {
      const day = s.local.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), s]);
    }
    return [...map.entries()];
  }, [slots]);

  return (
    <Card data-testid="gc-preview">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Vista previa: próximos horarios libres</CardTitle>
          <Button variant="outline" size="sm" onClick={load}>
            Actualizar
          </Button>
        </div>
        <CardDescription>
          Lo que el agente puede ofrecer esta semana (reglas + ocupación real del calendario).
          Nunca se muestran datos de los eventos existentes, solo los huecos.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {error && <p className="text-sm text-[#a2504c]">{error}</p>}
        {!error && slots === null && <p className="text-sm text-muted-foreground">Calculando…</p>}
        {!error && slots !== null && slots.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay horarios libres en los próximos 7 días con estas reglas.</p>
        )}
        <div className="space-y-2">
          {byDay.map(([day, list]) => (
            <div key={day} className="flex flex-wrap items-center gap-1.5 text-xs" data-testid={`gc-preview-day-${day}`}>
              <span className="w-24 shrink-0 font-medium">{list[0]!.label.slice(0, list[0]!.label.lastIndexOf(" "))}</span>
              {list.map((s) => (
                <span key={s.start} className="rounded border px-1.5 py-0.5 tabular-nums">
                  {s.local.slice(11)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------- Turnos ---------------- */

function AppointmentsCard() {
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/integrations/google-calendar/appointments").catch(() => null);
    if (!res?.ok) {
      setItems([]);
      return;
    }
    const d = (await res.json()) as { appointments: Appointment[] };
    setItems(d.appointments);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    setBusyId(id);
    await fetch(`/api/integrations/google-calendar/appointments/${id}/cancel`, { method: "POST" }).catch(() => null);
    setBusyId(null);
    await load();
  }

  function fmt(a: Appointment): string {
    try {
      return new Intl.DateTimeFormat("es-AR", {
        timeZone: a.timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(a.startsAt));
    } catch {
      return a.startsAt;
    }
  }

  return (
    <Card data-testid="gc-appointments">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Turnos agendados desde el CRM</CardTitle>
          <Button variant="outline" size="sm" onClick={load}>
            Actualizar
          </Button>
        </div>
        <CardDescription>Próximos turnos creados por el agente o el equipo. Cancelar también borra el evento del calendario.</CardDescription>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        {items === null && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {items !== null && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no hay turnos agendados.</p>
        )}
        <ul className="divide-y">
          {(items ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2 text-sm" data-testid={`gc-appointment-${a.id}`}>
              <span className="w-44 shrink-0 tabular-nums">{fmt(a)}</span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{a.contactName}</span>{" "}
                <span className="text-muted-foreground">+{a.contactPhone}</span>
                {a.note && <span className="text-muted-foreground"> · {a.note}</span>}
              </span>
              <Badge variant={a.status === "confirmed" ? "success" : "secondary"}>
                {a.status === "confirmed" ? "Confirmado" : "Cancelado"}
              </Badge>
              <span className="text-xs text-muted-foreground">{a.createdBy === "agent" ? "Agente" : "Equipo"}</span>
              {a.status === "confirmed" && (
                <Button variant="ghost" size="sm" disabled={busyId === a.id} onClick={() => cancel(a.id)}>
                  Cancelar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
