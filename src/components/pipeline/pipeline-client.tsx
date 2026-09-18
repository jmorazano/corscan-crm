"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ArrowRightLeft,
  MessageSquareText,
  Settings2,
  Trophy,
  XCircle,
} from "lucide-react";
import type { StageDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { ActionSheet, type SheetAction } from "@/components/ui/action-sheet";
import { formatTime } from "@/components/inbox/helpers";
import { StageManager } from "./stage-manager";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  contact: { id: string; name: string; phone: string };
  conversationId: string | null;
};

export function PipelineClient() {
  const router = useRouter();
  const [stages, setStages] = useState<StageDto[]>([]);
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  // 012: toque en una tarjeta → hoja «Abrir conversación / Mover a…».
  const [sheetLead, setSheetLead] = useState<BoardLead | null>(null);
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);

  // Mouse: 6 px de recorrido. Táctil: mantener 250 ms (como WhatsApp), así
  // el scroll de la columna y el arrastre no compiten (FR-012).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { stages: StageDto[]; leads: BoardLead[] };
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages]
  );

  useEffect(() => {
    if (!activeStageId && sortedStages[0]) setActiveStageId(sortedStages[0].id);
  }, [sortedStages, activeStageId]);

  const moveLead = useCallback(
    async (lead: BoardLead, stageId: string) => {
      if (lead.stageId === stageId) return;
      const position = leads.filter((l) => l.stageId === stageId).length;
      // Optimista + persistencia (mismo endpoint que el drag).
      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stageId, position } : l))
      );
      await fetch(`/api/pipeline/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stageId, position }),
      }).catch(() => null);
      void refetch();
    },
    [leads, refetch]
  );

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    // El click que sigue a un arrastre no debe abrir la hoja.
    justDragged.current = true;
    window.setTimeout(() => {
      justDragged.current = false;
    }, 200);
    const overStage = event.over ? String(event.over.id) : null;
    const lead = leads.find((l) => l.id === String(event.active.id));
    if (!overStage || !lead) return;
    await moveLead(lead, overStage);
  }

  function openSheet(lead: BoardLead) {
    if (justDragged.current) return;
    setSheetLead(lead);
  }

  /** Tira de etapas (móvil): desplaza la columna al centro. */
  function scrollToStage(stageId: string) {
    setActiveStageId(stageId);
    document
      .getElementById(`stage-${stageId}`)
      ?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  /** Scroll-spy: la columna más centrada marca la pestaña activa. */
  function onBoardScroll() {
    const board = boardRef.current;
    if (!board) return;
    const center = board.scrollLeft + board.clientWidth / 2;
    let best: { id: string; dist: number } | null = null;
    for (const s of sortedStages) {
      const el = document.getElementById(`stage-${s.id}`);
      if (!el) continue;
      const mid = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(mid - center);
      if (!best || dist < best.dist) best = { id: s.id, dist };
    }
    if (best && best.id !== activeStageId) setActiveStageId(best.id);
  }

  const sheetActions: SheetAction[] = sheetLead
    ? [
        ...(sheetLead.conversationId
          ? [
              {
                key: "open",
                label: "Abrir conversación",
                icon: MessageSquareText,
                onSelect: () =>
                  router.push(`/inbox?contact=${sheetLead.contact.id}`),
              } satisfies SheetAction,
            ]
          : []),
        ...sortedStages
          .filter((s) => s.id !== sheetLead.stageId)
          .map(
            (s) =>
              ({
                key: `move-${s.id}`,
                label: `Mover a ${s.name}`,
                icon:
                  s.kind === "won"
                    ? Trophy
                    : s.kind === "lost"
                      ? XCircle
                      : ArrowRightLeft,
                onSelect: () => void moveLead(sheetLead, s.id),
              }) satisfies SheetAction
          ),
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3 md:px-6 md:py-4">
        <h2 className="font-semibold">Pipeline</h2>
        <Button variant="outline" size="sm" onClick={() => setManaging(true)}>
          <Settings2 className="h-4 w-4" /> Gestionar etapas
        </Button>
      </header>

      {/* Tira de etapas (solo móvil): salto directo + conteo. */}
      {sortedStages.length > 0 && (
        <div
          role="tablist"
          aria-label="Etapas"
          data-testid="stage-strip"
          className="scrollbar-none flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2 md:hidden"
        >
          {sortedStages.map((s) => {
            const active = s.id === activeStageId;
            const count = leads.filter((l) => l.stageId === s.id).length;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => scrollToStage(s.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                  active
                    ? "border-brand bg-brand text-white"
                    : "bg-background text-text-2"
                )}
              >
                {s.name}
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[11px]",
                    active ? "bg-white/20" : "bg-secondary text-text-3"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={boardRef}
        onScroll={onBoardScroll}
        className="min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto p-3 md:snap-none md:p-4"
      >
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="flex h-full gap-3">
            {sortedStages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                leads={leads
                  .filter((l) => l.stageId === stage.id)
                  .sort((a, b) => a.position - b.position)}
                onOpen={openSheet}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? <LeadCard lead={activeLead} overlay /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      <ActionSheet
        open={sheetLead !== null}
        onClose={() => setSheetLead(null)}
        title={sheetLead?.contact.name}
        description={sheetLead ? `+${sheetLead.contact.phone}` : undefined}
        actions={sheetActions}
        testId="lead-sheet"
      />

      <StageManager
        open={managing}
        stages={stages}
        onClose={() => setManaging(false)}
        onChanged={() => void refetch()}
      />
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onOpen,
}: {
  stage: StageDto;
  leads: BoardLead[];
  onOpen: (lead: BoardLead) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      id={`stage-${stage.id}`}
      data-testid="stage-column"
      className={cn(
        "flex h-full w-[85vw] shrink-0 snap-center flex-col rounded-lg border bg-card/50 md:w-64 md:snap-align-none",
        isOver && "ring-2 ring-primary/60"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.name}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead key={lead.id} lead={lead} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function DraggableLead({
  lead,
  onOpen,
}: {
  lead: BoardLead;
  onOpen: (lead: BoardLead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(lead)}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function LeadCard({ lead, overlay = false }: { lead: BoardLead; overlay?: boolean }) {
  return (
    <div
      data-testid="lead-card"
      className={cn(
        "cursor-grab rounded-md border bg-card p-3 shadow-sm",
        overlay && "rotate-2 shadow-xl"
      )}
    >
      <div className="flex items-center gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{lead.contact.name}</p>
          <p className="text-[11px] text-muted-foreground">
            {lead.lastActivityAt
              ? `Actividad: ${formatTime(lead.lastActivityAt)}`
              : "Sin actividad"}
          </p>
        </div>
        {lead.conversationId && (
          <Link
            href={`/inbox?contact=${lead.contact.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            aria-label="Abrir conversación"
            className="flex h-9 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground md:h-auto md:w-auto md:p-1"
          >
            <MessageSquareText className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
