# Calendarios de Airbnb (051)

Para complejos cuyo sistema no tiene API pero sí sincroniza la ocupación con
Airbnb (directamente o por un *channel manager*). El calendario que exporta
cada publicación dice qué noches están tomadas por **cualquier** canal: el
agente lo usa para saber qué unidades están libres.

## Qué hace

- El agente responde «¿tienen lugar del 12 al 15 para 4?» nombrando, una por
  una, las unidades libres que alcanzan para el grupo, y manda **tu** enlace
  para reservar (nunca la publicación de Airbnb).
- Sin lugar, ofrece hasta 3 fechas cercanas (±7 días) con las mismas noches.
- Nunca dice que una unidad quedó reservada: la reserva la confirma tu sistema.
- No conoce precios, mínimos de noches ni políticas: eso va en el
  conocimiento del agente (Entrenador).

## Cómo se configura (propietario)

1. **Integraciones → Calendarios de Airbnb**.
2. Cargá el **enlace para reservar** del complejo. Si tu sitio acepta las
   fechas en la dirección, usá `{entrada}`, `{salida}` y `{huespedes}`.
3. **Agregar unidad**, una por publicación:
   - Nombre como lo dice el agente («Cabaña Abeto») y capacidad máxima.
   - Enlace del calendario: en Airbnb, publicación → **Calendario** →
     **Disponibilidad** → **Conectar con otro sitio web** → **Paso 1** →
     **Copiar**. Es privado (lleva una llave): no lo compartas.
   - Al guardar se lee el calendario para comprobar que funciona.
4. Compará la grilla de 30 días de cada unidad con tu sistema.

## Cómo se mantiene al día

- Se lee cada 15 minutos, de a una unidad. «Leer ahora» fuerza una lectura
  (una vez por minuto).
- Si una unidad no se pudo leer en 3 horas, el agente no la ofrece.
- Si regenerás el enlace en Airbnb, el viejo deja de valer: el panel lo avisa
  («Requiere reconexión») y hay que pegar el nuevo en **Editar**.
- La ocupación llega con unos minutos de demora (tu sistema → Airbnb → el
  CRM): por eso el agente informa y tu sistema confirma.
