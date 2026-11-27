# Fix: quién cambió el nombre del contacto + teléfono siempre a la vista

Caso real (Distrito Inmobiliario (Administración), 26-nov-2026): alguien del
equipo le puso a mano «GIGI - miracielos 504» a otra inquilina; la cabecera del
chat mostraba «ventana abierta» en lugar del número y no se notaba.

Entorno: dev con mocks (`WA_MOCK_ENABLED=true`), usuario e2e@vocero.test,
migración 0040 aplicada.

1. Entrante simulado: `POST /api/dev/wa-mock/inbound`
   `{ phoneNumberId: "111111111", from: "5493517070001", name: "Mariela", text: "Es la boleta…" }`
   → contacto «Mariela», `nameEditedAt` null.
2. Contactos → buscar 7070001 → Editar → Nombre «GIGI - miracielos 504» → Guardar.
   - API: `nameEditedAt` con fecha y `nameEditedByName` = «Operador E2E». ✅
3. Guardar otra vez con el MISMO nombre y una etiqueta nueva (lo que hace el
   diálogo): la marca no se mueve y NO aparece otra línea en el hilo. ✅
4. Bandeja → abrir el chat:
   - Cabecera: «+5493517070001 · ventana abierta» (el número siempre). ✅
   - Hilo: «Operador E2E cambió el nombre del contacto: «Mariela» → «GIGI - miracielos 504».» ✅
   - Ficha: «Nombre puesto a mano por Operador E2E · 27/11, 10:04». ✅
5. Contactos → Editar: la misma marca debajo del campo Nombre. ✅

Verificado el 27-nov-2026 en el Browser pane.
