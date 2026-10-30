# El agente ve el nombre del perfil del contacto

Pedido de Altos de Calamuchita / Altos de la Ciudad (30-oct-2026): le
cargaron al agente «saludá con el nombre del perfil de WhatsApp» y saludaba a
todos sin nombre — el prompt nunca incluía el nombre del contacto. Ahora va la
sección `CONTACTO` (`contactSection` / `promptContact` en
`src/server/ai/prompts.ts`).

Conducción: `POST /api/dev/wa-mock/inbound` a `pn_mock_1` (panadería) + BD
por `docker exec … psql`. El ai-mock contesta «¿cómo me llamo?» con el nombre
de pila que encuentre en la sección `CONTACTO` (`dispatchContactName`).

## Pasos

1. ✔ Entrante de `5493410000771` con perfil «Gerardo Agustín» y texto
   «Hola, ¿cómo me llamo?» → el agente responde «¡Hola, Gerardo!».
2. ✔ Entrante con el perfil vacío (el CRM guarda el teléfono como nombre) →
   sin sección, «¡Hola! No sé cómo te llamás.»; nada se cuelga.
3. ✔ Contactos de prueba borrados.

Unitarios: `tests/unit/agent-contact-name.test.ts` (saneo, teléfono/`ig:` sin
sección, rótulo perfil/Instagram/guardado por el negocio, Laboratorio sin
sección, prompt sin contacto intacto).

## Emojis y diminutivos (30-oct-2026)

- [x] Entrante de «Niko 🐨🐨🐨» con «hola, cómo me llamo?» → el prompt lleva
  `CONTACTO: …: «Niko»` y el agente (ai-mock) responde «¡Hola, Niko!» ✔
