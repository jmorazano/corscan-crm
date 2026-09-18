# Implementation Plan: CRM móvil — usabilidad estilo WhatsApp

**Branch**: `012-mobile-responsive` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

## Summary

Convertir la UI de escritorio en una app responsive con shell móvil (barra de
pestañas inferior + hoja «Más»), bandeja apilada estilo WhatsApp (lista →
hilo → ficha, gestos de borde/deslizar/long-press, respuestas rápidas con
`/`, botón «↓», copiar), pipeline táctil (snap + long-press + «Mover a…»),
diálogos compartidos como hojas inferiores y adaptación de todas las páginas.
Sin migraciones; un solo cambio de API (`markUnread`). Todo mobile-first con
`md:` como escritorio; escritorio ≥ 768 px queda visualmente igual.

## Technical Context

**Language/Version**: TypeScript estricto · Next.js 15 (App Router) · React 19
**Primary Dependencies**: Tailwind 3.4 (breakpoints por defecto; `h-dvh`
disponible), `@dnd-kit/core` (MouseSensor + TouchSensor), lucide-react,
`next/og` (`ImageResponse`, ya incluido en Next: íconos PWA sin deps nuevas)
**Storage**: PostgreSQL — sin cambios de esquema
**Testing**: Vitest (helpers puros de gestos/atajos/`markUnread`) + guion E2E
`tests/e2e/012-mobile.md` conducido con el Browser pane en 375×812 y ≥ 1024
**Target Platform**: navegadores móviles (Safari iOS 16+, Chrome Android) y
escritorio; PWA instalable sin service worker
**Constraints**: cero regresión de escritorio; sin servicios externos; tap
targets ≥ 44 px; inputs ≥ 16 px; sin scroll horizontal en 375 px

## Constitution Check

- I Seguridad: sin secretos nuevos; el manifest/íconos solo exponen nombre y
  color de marca (ya públicos en la UI). ✅
- II Soberanía: `ImageResponse` es parte de Next (no es servicio externo); sin
  CDN, sin SW, sin push. ✅
- III Multi-tenancy: manifest e íconos se resuelven por la organización de la
  sesión (`getBranding(session.organizationId)`), neutro sin sesión. ✅
- IV Idempotencia: `markUnread` es idempotente (`unreadCount = max(1, actual)`). ✅
- V/IX Verificación: gate técnico + E2E móvil y escritorio conducidos por el
  implementador. ✅
- VIII Foco vertical: atender conversaciones desde el celular es el núcleo. ✅

## Diseño

### Breakpoint y detección

- CSS: mobile-first; `md:` = escritorio. Estructuras distintas (sidebar vs
  tab bar, panel vs pantalla) se resuelven por clases (`hidden md:flex`),
  sin flash de hidratación.
- JS: `useIsMobile()` (`matchMedia("(max-width: 767px)")`) solo para
  COMPORTAMIENTO (push vs replace del historial, Enter envía o no, sensores).

### Shell (`src/components/app-shell.tsx`, nuevo, cliente)

- Envuelve `children`; provee `MobileChromeContext { setTabBarHidden }`.
- Renderiza `AppNav` (`hidden md:flex`) + `MobileTabBar` (`md:hidden`, fixed
  bottom, `pb-[env(safe-area-inset-bottom)]`) + `main` con `pb` cuando la
  barra está visible.
- `MobileTabBar`: Bandeja (badge de no leídos vía el mismo fetch/SSE que el
  sidebar → el conteo se extrae a `useUnreadBadge()`), Pipeline, Contactos,
  Campañas, Más (abre `MoreSheet`: Agente, Laboratorio, Integraciones,
  Ajustes, Administración si super admin, usuario + Cerrar sesión).
- Layout raíz: `h-dvh` + `flex-col md:flex-row`; `export const viewport`
  (`generateViewport`) y metadata Apple/manifest en `src/app/layout.tsx`.

### PWA

- `src/app/manifest.ts`: `MetadataRoute.Manifest` dinámico por marca
  (`name`, `short_name`, `theme_color`, `background_color`, `display:
  standalone`, `start_url: /inbox`, `icons` 192/512 `any maskable`).
- `src/app/api/pwa/icon/[size]/route.tsx`: PNG con `ImageResponse` (inicial
  sobre acento), tamaños permitidos {180, 192, 512}, cache 1 día.

### Primitivas compartidas

- `src/components/ui/dialog.tsx`: `Dialog { open, onClose, title, children,
  footer?, size? }`. Portal a `document.body`; Escape; backdrop; scroll lock;
  foco inicial; `history.pushState` en móvil para que atrás cierre. Móvil:
  hoja inferior (`rounded-t-2xl`, asa, `max-h-[90dvh]`, `overflow-y-auto`,
  animación `slide-up`); escritorio: modal centrado (`max-w-*` actual).
- `src/components/ui/action-sheet.tsx`: `ActionSheet { open, onClose, title?,
  actions: {label, icon?, destructive?, disabled?, onSelect}[] }` sobre
  `Dialog`; en escritorio se ve como menú compacto.
- `src/components/gestures.ts`: matemática pura y testeable
  (`classifySwipe`, `edgeSwipeBack`, `longPressState`) + hooks
  `useSwipeBack(onBack)`, `useLongPress(cb)`; componente `SwipeRow`
  (transform con `translateX`, acciones reveladas a la izquierda, se cancela
  con scroll vertical, un solo `SwipeRow` abierto a la vez).
- Primitivas: `button` (`h-11 md:h-9`, `sm: h-10 md:h-8`, `icon: h-11 w-11
  md:h-9 md:w-9`), `input`/`textarea` (`text-base md:text-sm`, `h-11 md:h-9`),
  `card` (`p-4 md:p-5`); `globals.css`: fuente ≥ 16 px en campos nativos bajo
  768, checkboxes 18 px, `overscroll-behavior-y: contain`, tap-highlight
  transparente, `.safe-bottom`, keyframes `sheet-up`.

### Bandeja (`src/components/inbox/*`)

- Estado de vista móvil derivado de la URL: `c=<id>` (hilo) y `d=1`
  (ficha). `useQueryFilters.set(patch, { push })`: push en móvil, replace en
  escritorio. `popstate` ya re-lee la URL → atrás funciona.
- `inbox-client.tsx`: tres `<section>`; en móvil se muestra una sola
  (`hidden md:block` según vista). Cabecera del hilo con «←» (`md:hidden`),
  nombre tocable (abre ficha). Al abrir un hilo en móvil se oculta la tab
  bar (contexto). `useSwipeBack` sobre la sección del hilo.
- `conversation-list.tsx`: filas dentro de `SwipeRow` (acciones: Leída/No
  leída, Más → `ActionSheet`: IA pausar/reanudar, Ver ficha, Eliminar con
  confirmación por `Dialog`); `useLongPress` → modo selección; `select-none`
  en táctil.
- `message-thread.tsx`: `max-w-[85%] md:max-w-[64%]`, `px-3 md:px-[6%]`;
  auto-scroll solo si `distanceToBottom < 80`; FAB «↓» con contador; long-
  press en burbuja → `ActionSheet` «Copiar texto».
- `composer.tsx`: `/` → `QuickReplies` popover (lista filtrada de plantillas
  aprobadas; ↑/↓/Enter/Esc en escritorio; toque en móvil); Enter envía solo
  si `!isMobile`; botón ⚡ (`md:hidden`) abre el mismo selector; `safe-bottom`.
- Atajos (escritorio, `inbox-client.tsx`): `keydown` global ignorando campos
  editables salvo `⌘K`/`Esc`: `⌘/Ctrl+K`, `Alt+↓/↑`, `Esc`, `⌘/Ctrl+Shift+U`.
- API: `markUnread` en `PATCH /api/conversations/[id]` + `updateConversation`.

### Pipeline (`src/components/pipeline/pipeline-client.tsx`)

- Sensores: `MouseSensor {distance: 6}` + `TouchSensor {delay: 250,
  tolerance: 8}`; `touch-action: manipulation` en tarjetas.
- Móvil: contenedor `snap-x snap-mandatory`, columnas `w-[85vw] snap-center
  md:w-64`; tira de etapas (`md:hidden`) con conteo y scroll a la columna
  (`scrollIntoView`).
- Toque en tarjeta (sin drag) → `ActionSheet` «Abrir conversación» + «Mover
  a <etapa>» (mismo `PATCH /api/pipeline/leads/[id]`).
- `stage-manager.tsx` → `Dialog`; fila de etapa envolvible.

### Resto de páginas

- Contactos: cabecera apilada (`flex-col md:flex-row`, búsqueda `w-full
  md:w-72`), acciones por fila `hidden md:flex` + «⋯» `md:hidden` →
  `ActionSheet`; 4 diálogos → `Dialog`. Import wizard: `grid-cols-1
  sm:grid-cols-3`, tablas en `overflow-x-auto` + `min-w-[480px]`.
- Campañas: `flex-wrap` en clústeres, tabla destinatarios `min-w-[520px]`,
  `ConfirmDialog`/`NewCampaignDialog` → `Dialog`.
- Ajustes: `settings-nav` → tira horizontal (`flex md:flex-col`,
  `overflow-x-auto md:overflow-visible`, `border-b md:border-r`), `p-4 md:p-6`;
  sending `grid-cols-1 sm:grid-cols-3`; templates: quitar `hidden md:block`;
  branding: swatches `h-8 w-8` con `aria-label`.
- Integraciones GCal: filas de rango con `flex-wrap`/`grid`, cita con
  `flex-col sm:flex-row`. Lab: contadores `text-xl md:text-2xl`. Admin: OK.
- Cabeceras de página: `px-4 py-3 md:px-6 md:py-4`; contenedores `p-4 md:p-6`.

## Project Structure

```text
specs/012-mobile-responsive/{spec.md, plan.md, tasks.md}
src/app/layout.tsx                      (viewport + metadata PWA)
src/app/manifest.ts                     (nuevo)
src/app/api/pwa/icon/[size]/route.tsx   (nuevo)
src/app/(app)/layout.tsx                (AppShell, h-dvh)
src/components/app-shell.tsx            (nuevo: contexto + tab bar + Más)
src/components/app-nav.tsx              (sidebar; badge extraído a hook)
src/components/use-unread-badge.ts      (nuevo)
src/components/use-media.ts             (nuevo: useIsMobile)
src/components/gestures.ts(x)           (nuevo: puro + hooks + SwipeRow)
src/components/ui/{dialog,action-sheet}.tsx (nuevos)
src/components/ui/{button,input,textarea,card}.tsx
src/components/inbox/*                  (bandeja móvil)
src/components/inbox/quick-replies.tsx  (nuevo)
src/components/pipeline/*               (táctil)
src/components/{contacts,campaigns,settings,integrations,lab}/*
src/app/api/conversations/[id]/route.ts + src/server/inbox/queries.ts (markUnread)
src/app/globals.css
tests/unit/{gestures,inbox-shortcuts,mark-unread}.test.ts
tests/e2e/012-mobile.md
```

## Complexity Tracking

Sin violaciones. Se agrega un componente `Dialog` compartido que REEMPLAZA
nueve implementaciones artesanales (reduce complejidad neta).
