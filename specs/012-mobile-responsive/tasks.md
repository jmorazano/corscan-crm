# Tasks: CRM móvil — usabilidad estilo WhatsApp

**Input**: specs/012-mobile-responsive/spec.md + plan.md (sin migraciones;
un cambio de API: `markUnread`).

## Phase 1: Fundaciones compartidas (bloquea a todas las historias)

- [x] T001 Viewport (`generateViewport`: cover, resizes-content, theme-color
      de marca) + metadata Apple/manifest en src/app/layout.tsx
- [x] T002 [P] Manifest dinámico por marca en src/app/manifest.ts + íconos PNG
      `ImageResponse` en src/app/api/pwa/icon/[size]/route.tsx (+ src/lib/pwa.ts:
      la marca viaja en la query porque el navegador baja íconos sin cookies)
- [x] T003 [P] Primitivas táctiles: src/components/ui/button.tsx (h-11 md:h-9…),
      input.tsx/textarea.tsx (text-base md:text-sm), card.tsx (p-4 md:p-5) +
      reglas globales (16px en campos, checkbox 18px, overscroll, tap-highlight,
      `.safe-bottom`, `.scrollbar-none`, `.no-callout`) en src/app/globals.css
- [x] T004 [P] `useIsMobile()` en src/components/use-media.ts
- [x] T005 [P] `Dialog` compartido (portal, Escape, backdrop, scroll lock, foco,
      hoja inferior en móvil / modal en escritorio, atrás cierra, robusto ante
      Strict Mode) en src/components/ui/dialog.tsx + `ActionSheet` (difiere la
      acción hasta que el historial se estabiliza) en src/components/ui/action-sheet.tsx
- [x] T006 [P] Gestos: helpers puros (`classifySwipe`, `isEdgeSwipeBack`,
      `clampReveal`/`settleReveal`, `longPressCancelled`, `inboxShortcut`,
      `quickReplyQuery`) en src/lib/gestures.ts + hooks `useSwipeBack`,
      `useLongPress` y componente `SwipeRow` en src/components/gestures.tsx +
      tests/unit/gestures.test.ts (16 tests)

## Phase 2: US1 — Shell móvil instalable

- [x] T007 [US1] Badge de no leídos extraído a src/components/use-unread-badge.ts
      (fetch + SSE, una sola suscripción) y `unread` por prop en src/components/app-nav.tsx
- [x] T008 [US1] `AppShell` (contexto `useHideTabBar`, `MobileTabBar` con
      safe-area, `MoreSheet` con Agente/Lab/Integraciones/Ajustes/Admin/usuario/
      salir navegando con replace, altura real con teclado iOS) en
      src/components/app-shell.tsx; sidebar `hidden md:flex`
- [x] T009 [US1] Layout con AppShell en src/app/(app)/layout.tsx

## Phase 3: US2 — Bandeja estilo WhatsApp

- [x] T010 [US2] `markUnread` en src/app/api/conversations/[id]/route.ts +
      src/server/inbox/queries.ts (`greatest(unread_count, 1)`) +
      tests/unit/mark-unread.test.ts
- [x] T011 [US2] `useQueryFilters.set(patch, {push})` en
      src/components/use-query-filters.ts
- [x] T012 [US2] Vista apilada por URL (`c`, `d`), cabecera con «←» y nombre
      tocable, `useSwipeBack` en hilo y ficha, ocultar tab bar, atajos de
      escritorio (⌘K, Alt+↑/↓, Esc, ⌘⇧U), `?c=` en escritorio (replace),
      `goToList` que retira las entradas propias del historial en
      src/components/inbox/inbox-client.tsx
- [x] T013 [US2] Filas con `SwipeRow` (Leída/No leída, Más → ActionSheet: IA,
      ficha, eliminar con Dialog), long-press → selección (+ vibración),
      Escape sale de selección, limpiar búsqueda, cabecera móvil en
      src/components/inbox/conversation-list.tsx
- [x] T014 [US2] Burbujas 85% en móvil, auto-scroll solo al final o al enviar
      (la IA cuenta como nuevo) + FAB «↓» con contador, long-press → Copiar
      (con fallback y aviso) en src/components/inbox/message-thread.tsx
- [x] T015 [US2] Respuestas rápidas con `/` (src/components/inbox/quick-replies.tsx),
      Enter envía solo en escritorio, botón ⚡, safe-area, botón de envío
      redondo 44px en src/components/inbox/composer.tsx
- [x] T016 [US2] Ficha como pantalla completa en móvil (cabecera con «←») en
      src/components/inbox/contact-panel.tsx

## Phase 4: US3 — Pipeline táctil

- [x] T017 [US3] MouseSensor + TouchSensor(delay 250), columnas
      `w-[85vw] snap-center md:w-64`, tira de etapas móvil con scroll-spy,
      toque en tarjeta → ActionSheet «Abrir conversación» / «Mover a…» en
      src/components/pipeline/pipeline-client.tsx
- [x] T018 [US3] StageManager sobre `Dialog` (prop `open`), filas envolvibles en
      src/components/pipeline/stage-manager.tsx

## Phase 5: US4 — Resto del CRM en el celular

- [x] T019 [P] [US4] Contactos: cabecera apilada, «⋯» → ActionSheet
      (`contact-more` / `contact-actions-sheet`), 4 diálogos + borrado → `Dialog`
      en src/components/contacts/contacts-client.tsx; wizard sobre `Dialog`
      (`grid-cols-1 sm:grid-cols-3`, tablas con scroll) en
      src/components/contacts/import-wizard.tsx
- [x] T020 [P] [US4] Campañas: clústeres `flex-wrap`, tabla `min-w-[520px]`,
      diálogos → `Dialog` en src/components/campaigns/campaigns-client.tsx
- [x] T021 [P] [US4] Ajustes: tira horizontal en src/components/settings/settings-nav.tsx,
      layout móvil en src/app/(app)/settings/layout.tsx, grillas/ocultos/
      swatches/input de archivo en sending-client.tsx, templates-client.tsx,
      branding-client.tsx (+ ai-card, whatsapp-wizard, team)
- [x] T022 [P] [US4] Integraciones GCal (rangos y citas envolvibles, fieldset
      `min-w-0`) en src/components/integrations/google-calendar-client.tsx;
      Lab contadores en src/components/lab/lab-client.tsx; cabeceras
      `px-4 py-3 md:px-6 md:py-4` y `p-4 md:p-6` en agent/lab/admin/integrations/
      campaigns/contacts/pipeline

## Phase 6: Polish & verificación reforzada

- [x] T023 Guion E2E tests/e2e/012-mobile.md ejecutado en verde (17-sep-2026):
      shell/tab bar/Más, manifest e íconos, bandeja apilada (abrir, responder,
      ficha, atrás por botón/gesto/historial), swipe + no leída, long-press +
      selección, `/` respuestas rápidas, FAB «↓», copiar (infeliz: portapapeles
      denegado), pipeline «Mover a…», contactos/campañas/ajustes en 375px,
      regresión de escritorio con atajos
- [x] T024 Gate técnico completo + CLAUDE.md (fila del mapa) + memoria
