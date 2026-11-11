"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, BedDouble, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MAX_UNITS, UNIT_CAPACITY_MAX, UNIT_DESCRIPTION_MAX, UNIT_NAME_MAX } from "@/lib/ical/input";

/**
 * Calendarios de Airbnb (051): el propietario carga, unidad por unidad, el
 * enlace del calendario que exporta cada publicación. El agente consulta
 * esas ocupaciones (leídas cada 15 min) y manda el enlace PROPIO del
 * complejo para reservar. Jamás se muestra el enlace `.ics` (lleva la llave).
 */

type Unit = {
  id: string;
  name: string;
  capacity: number;
  description: string | null;
  bookingUrl: string | null;
  feedHost: string;
  listingId: string;
  tokenLast4: string | null;
  position: number;
  fetchedAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorText: string | null;
  stale: boolean;
  busyRanges: number;
};

type Data = {
  agentEnabled: boolean;
  bookingUrl: string | null;
  units: Unit[];
  today: string;
  gridDays: number;
  grid: Record<string, boolean[]>;
};

async function errorMessage(res: Response | null, fallback: string): Promise<string> {
  if (!res) return "No hay conexión. Probá de nuevo.";
  const body = (await res.json().catch(() => null)) as { error?: { message?: string }; message?: string } | null;
  return body?.error?.message ?? body?.message ?? fallback;
}

export function ago(iso: string | null): string {
  if (!iso) return "nunca";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 2) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function AirbnbCalendarsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Unit | "new" | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/integrations/airbnb-calendars").catch(() => null);
    if (!res?.ok) {
      setError(await errorMessage(res, "No se pudo cargar la integración."));
      return;
    }
    setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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
      <AgentCard data={data} onChanged={refetch} onError={setError} onNotice={setNotice} />
      <UnitsCard
        data={data}
        onChanged={refetch}
        onError={setError}
        onNotice={setNotice}
        onEdit={(u) => setEditing(u)}
      />
      {editing && (
        <UnitDialog
          unit={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (msg) => {
            setEditing(null);
            setError(null);
            setNotice(msg);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

function AgentCard({
  data,
  onChanged,
  onError,
  onNotice,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [bookingUrl, setBookingUrl] = useState(data.bookingUrl ?? "");
  const [busy, setBusy] = useState(false);

  async function save(patch: { agentEnabled?: boolean; bookingUrl?: string | null }, okText?: string) {
    setBusy(true);
    onError(null);
    const res = await fetch("/api/integrations/airbnb-calendars", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudo guardar."));
      return;
    }
    if (okText) onNotice(okText);
    await onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>El agente consulta estos calendarios</CardTitle>
            <CardDescription>
              Cuando un cliente pregunta si hay lugar en ciertas fechas, el agente mira la ocupación de
              cada unidad, le nombra las libres una por una y le pasa tu enlace para reservar. Nunca
              dice que una unidad quedó reservada: eso lo confirma tu sistema.
            </CardDescription>
          </div>
          <Switch
            checked={data.agentEnabled}
            aria-label="El agente consulta estos calendarios"
            data-testid="ical-agent-switch"
            disabled={busy}
            onClick={() => void save({ agentEnabled: !data.agentEnabled })}
            className="mt-1"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2 px-5 pb-5">
        <Label htmlFor="ical-booking-url">Enlace para reservar (del complejo)</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="ical-booking-url"
            data-testid="ical-booking-url"
            placeholder="https://tucomplejo.com/reservas"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={busy || bookingUrl.trim() === (data.bookingUrl ?? "")}
            onClick={() => void save({ bookingUrl: bookingUrl.trim() || null }, "Enlace de reservas guardado.")}
          >
            Guardar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Es el que el agente le manda al cliente (nunca la publicación de Airbnb). Si tu sitio acepta las
          fechas en el enlace, podés usar <code>{"{entrada}"}</code>, <code>{"{salida}"}</code> y{" "}
          <code>{"{huespedes}"}</code> y el agente los completa. Cada unidad puede tener el suyo.
        </p>
      </CardContent>
    </Card>
  );
}

function UnitsCard({
  data,
  onChanged,
  onError,
  onNotice,
  onEdit,
}: {
  data: Data;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
  onEdit: (u: Unit | "new") => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState<Unit | null>(null);

  async function syncNow() {
    setSyncing(true);
    onError(null);
    const res = await fetch("/api/integrations/airbnb-calendars/sync", { method: "POST" }).catch(() => null);
    setSyncing(false);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudieron leer los calendarios."));
      return;
    }
    onNotice("Calendarios leídos.");
    await onChanged();
  }

  async function move(index: number, delta: number) {
    const ids = data.units.map((u) => u.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    const res = await fetch("/api/integrations/airbnb-calendars/units/order", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => null);
    if (!res?.ok) onError("No se pudo cambiar el orden.");
    await onChanged();
  }

  async function remove(unit: Unit) {
    const res = await fetch(`/api/integrations/airbnb-calendars/units/${unit.id}`, { method: "DELETE" }).catch(
      () => null
    );
    setDeleting(null);
    if (!res?.ok) {
      onError(await errorMessage(res, "No se pudo quitar la unidad."));
      return;
    }
    onNotice(`Quitamos «${unit.name}». El agente ya no la ofrece.`);
    await onChanged();
  }

  return (
    <Card data-testid="ical-units">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Unidades ({data.units.length}/{MAX_UNITS})
          </CardTitle>
          <div className="flex gap-2">
            {data.units.length > 0 && (
              <Button size="sm" variant="outline" disabled={syncing} onClick={() => void syncNow()} data-testid="ical-sync">
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Leyendo…" : "Leer ahora"}
              </Button>
            )}
            <Button
              size="sm"
              disabled={data.units.length >= MAX_UNITS}
              onClick={() => onEdit("new")}
              data-testid="ical-add-unit"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Agregar unidad
            </Button>
          </div>
        </div>
        <CardDescription>
          Los calendarios se leen solos cada 15 minutos. Una unidad que no se pudo leer en las últimas 3
          horas no se ofrece hasta que vuelva a leerse.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-5 pb-5">
        {data.units.length === 0 ? (
          <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
            <BedDouble className="mx-auto mb-2 h-6 w-6 text-text-3" strokeWidth={1.5} />
            Todavía no cargaste ninguna unidad. Agregá la primera con el enlace del calendario de su
            publicación en Airbnb.
          </div>
        ) : (
          <ul className="space-y-3">
            {data.units.map((u, i) => (
              <li key={u.id} className="rounded-md border p-3" data-testid={`ical-unit-${u.listingId}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {u.name}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        · hasta {u.capacity} {u.capacity === 1 ? "persona" : "personas"}
                      </span>
                    </p>
                    {u.description && <p className="text-sm text-muted-foreground">{u.description}</p>}
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {u.feedHost} · publicación {u.listingId}
                      {u.tokenLast4 ? ` · llave …${u.tokenLast4}` : ""} · leído {ago(u.lastOkAt)}
                    </p>
                  </div>
                  <UnitBadge unit={u} />
                </div>
                {u.lastErrorText && (
                  <p className="mt-2 text-xs text-[#a2504c]" data-testid="ical-unit-error">
                    {u.lastErrorText}
                  </p>
                )}
                <DayGrid days={data.grid[u.id] ?? []} today={data.today} />
                <div className="mt-2 flex flex-wrap gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(u)} aria-label={`Editar ${u.name}`}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                  </Button>
                  <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => void move(i, -1)} aria-label="Subir">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === data.units.length - 1}
                    onClick={() => void move(i, 1)}
                    aria-label="Bajar"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(u)} aria-label={`Quitar ${u.name}`}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Quitar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="¿Quitar la unidad?"
        description={deleting ? `El agente deja de ofrecer «${deleting.name}». En Airbnb no se toca nada.` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => deleting && void remove(deleting)} data-testid="ical-confirm-delete">
              Quitar
            </Button>
          </div>
        }
      >
        <span />
      </Dialog>
    </Card>
  );
}

function UnitBadge({ unit }: { unit: Unit }) {
  if (unit.stale) return <Badge variant="warning">Sin confirmar</Badge>;
  if (unit.lastError) return <Badge variant="warning">Último intento falló</Badge>;
  return <Badge variant="success">Al día</Badge>;
}

const WEEKDAY = ["D", "L", "M", "M", "J", "V", "S"];

function DayGrid({ days, today }: { days: boolean[]; today: string }) {
  if (days.length === 0) return null;
  const start = new Date(`${today}T12:00:00Z`);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-[3px]" aria-label="Ocupación de los próximos 30 días">
        {days.map((busy, i) => {
          const d = new Date(start.getTime() + i * 86_400_000);
          const label = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
          return (
            <span
              key={i}
              title={`${WEEKDAY[d.getUTCDay()]} ${label}: ${busy ? "ocupado" : "libre"}`}
              className={`flex h-6 w-6 items-center justify-center rounded-[4px] text-[10px] ${
                busy ? "bg-text-4 text-white" : "border border-[#d8e8dd] bg-[#eff7f1] text-[#3f6b52]"
              }`}
              data-busy={busy ? "1" : "0"}
            >
              {d.getUTCDate()}
            </span>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Próximos {days.length} días desde hoy · verde = libre, gris = ocupado. Comparalo con tu sistema.
      </p>
    </div>
  );
}

function UnitDialog({
  unit,
  onClose,
  onSaved,
}: {
  unit: Unit | null;
  onClose: () => void;
  onSaved: (msg: string) => Promise<void>;
}) {
  const [name, setName] = useState(unit?.name ?? "");
  const [capacity, setCapacity] = useState(String(unit?.capacity ?? 2));
  const [description, setDescription] = useState(unit?.description ?? "");
  const [icalUrl, setIcalUrl] = useState("");
  const [bookingUrl, setBookingUrl] = useState(unit?.bookingUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const payload = {
      name: name.trim(),
      capacity: Number(capacity),
      description: description.trim() || null,
      bookingUrl: bookingUrl.trim() || null,
      icalUrl: icalUrl.trim() || (unit ? null : ""),
    };
    const res = await fetch(
      unit ? `/api/integrations/airbnb-calendars/units/${unit.id}` : "/api/integrations/airbnb-calendars/units",
      {
        method: unit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    ).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(await errorMessage(res, "No se pudo guardar la unidad."));
      return;
    }
    await onSaved(unit ? `Guardamos «${payload.name}».` : `Agregamos «${payload.name}» y ya leímos su calendario.`);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={unit ? `Editar ${unit.name}` : "Agregar unidad"}
      size="lg"
      testId="ical-unit-dialog"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()} data-testid="ical-unit-save">
            {busy ? "Leyendo el calendario…" : "Guardar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p className="rounded-md border border-[#ecd4d2] bg-[#faf1f0] px-3 py-2 text-sm text-[#a2504c]" role="alert">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div className="space-y-1.5">
            <Label htmlFor="ical-name">Nombre (como lo dice el agente)</Label>
            <Input
              id="ical-name"
              data-testid="ical-name"
              maxLength={UNIT_NAME_MAX}
              placeholder="Cabaña Abeto"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ical-capacity">Hasta (personas)</Label>
            <Input
              id="ical-capacity"
              data-testid="ical-capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={UNIT_CAPACITY_MAX}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ical-description">Descripción corta (opcional)</Label>
          <Textarea
            id="ical-description"
            maxLength={UNIT_DESCRIPTION_MAX}
            rows={2}
            placeholder="2 dormitorios, hogar a leña, vista al bosque"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ical-url">Enlace del calendario de Airbnb</Label>
          <Input
            id="ical-url"
            data-testid="ical-url"
            autoComplete="off"
            placeholder={
              unit
                ? `Guardado (llave …${unit.tokenLast4 ?? "????"}). Dejalo vacío para conservarlo.`
                : "https://www.airbnb.com.ar/calendar/ical/….ics?t=…"
            }
            value={icalUrl}
            onChange={(e) => setIcalUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            En Airbnb: abrí la publicación → <b>Calendario</b> → <b>Disponibilidad</b> →{" "}
            <b>Conectar con otro sitio web</b> → en el <b>Paso 1</b> tocá <b>Copiar</b> y pegalo acá. Es
            privado: no lo compartas. Al guardar leemos el calendario para comprobar que funciona.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ical-unit-booking">Enlace para reservar esta unidad (opcional)</Label>
          <Input
            id="ical-unit-booking"
            placeholder="Si lo dejás vacío se usa el enlace general"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}
