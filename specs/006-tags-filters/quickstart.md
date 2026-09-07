# Quickstart — 006 etiquetas y filtros

1. `pnpm db:migrate` (agrega `conversation.tags`).
2. `pnpm dev` con los mocks de `.env` (WA_MOCK + ai-mock).
3. Contactos: importar `tests/e2e/fixtures/contactos.csv` o crear varios;
   tildar → "Agregar etiqueta" → filtrar por ella → recargar la URL.
4. Bandeja: generar conversaciones con `POST /api/dev/wa-mock/inbound`
   (o "Cargar datos de demostración"); "Seleccionar" → tildar → etiquetar;
   filtrar por etiqueta; editar desde el panel de detalles.
5. Guiones: `tests/e2e/us-tg-1-contactos.md`, `tests/e2e/us-tg-2-bandeja.md`.
