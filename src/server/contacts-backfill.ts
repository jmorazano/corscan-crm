import { and, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { normalizeToWaId } from "@/lib/phone";

/**
 * Backfill re-ejecutable (004, research D3): normaliza al formato wa_id los
 * `contact.phone` cargados antes de la feature (el POST viejo aceptaba
 * cualquier `^\d{7,15}$`, p. ej. un AR sin el 9). Sin esto, el import y las
 * respuestas del webhook crearían duplicados de la población preexistente.
 *
 * Política de colisión: si el canónico ya pertenece a OTRO contacto de la
 * org, se deja la fila como está y se loguea — fusionar filas (mover
 * conversaciones/leads) excede el alcance y el caso real es rarísimo.
 * Los contactos de prueba del Laboratorio no se tocan.
 */
export async function backfillContactPhones(): Promise<void> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.contact.id,
        organizationId: schema.contact.organizationId,
        phone: schema.contact.phone,
      })
      .from(schema.contact)
      .where(eq(schema.contact.isTest, false));

    let updated = 0;
    for (const row of rows) {
      const result = normalizeToWaId(row.phone);
      if (!result.ok || result.waId === row.phone) continue;

      const clash = await db
        .select({ id: schema.contact.id })
        .from(schema.contact)
        .where(
          and(
            eq(schema.contact.organizationId, row.organizationId),
            eq(schema.contact.phone, result.waId),
            ne(schema.contact.id, row.id)
          )
        )
        .limit(1);
      if (clash[0]) {
        console.warn(
          `[boot] backfill de teléfonos: ${row.id} no normalizado (colisión con ${clash[0].id})`
        );
        continue;
      }

      await db
        .update(schema.contact)
        .set({ phone: result.waId, updatedAt: new Date() })
        .where(eq(schema.contact.id, row.id));
      updated++;
    }
    if (updated > 0) {
      console.log(`[boot] backfill de teléfonos: ${updated} contacto(s) normalizado(s) a wa_id`);
    }
  } catch (err) {
    // La BD puede no estar lista aún; el próximo boot lo reintenta.
    console.error("[boot] backfill de teléfonos falló:", err);
  }
}
