import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { num, text } from "@/lib/format";
import { guard, requireProfile, sqlOf } from "./helpers";

export type ImportantNote = {
  id: number;
  kind: "text" | "image";
  body: string;
  image: string | null;
  createdAt: string;
};

function mapNote(r: Record<string, unknown>): ImportantNote {
  return {
    id: num(r.id),
    kind: text(r.kind) === "image" ? "image" : "text",
    body: text(r.body),
    image: r.image ? text(r.image) : null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : text(r.created_at),
  };
}

export const listImportantNotes = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ImportantNote[]> => {
    const sql = await sqlOf();
    await requireProfile(sql, context.userId);
    const rows = await sql<Record<string, unknown>>`
      select id, kind, body, image, created_at
      from important_notes
      where user_id = ${context.userId}
      order by created_at desc, id desc
    `;
    return rows.map(mapNote);
  });

export const saveImportantNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: number; kind: "text" | "image"; body?: string; image?: string | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "notes");
    const kind = data.kind === "image" ? "image" : "text";
    const body = (data.body ?? "").trim();
    const image = kind === "image" ? data.image || null : null;
    if (kind === "text" && !body) throw new Error("متن یادداشت را بنویسید");
    if (kind === "image" && !image) throw new Error("عکس را انتخاب کنید");
    if (data.id) {
      await sql`
        update important_notes
        set kind = ${kind}, body = ${body}, image = ${image}, updated_at = now()
        where id = ${data.id} and user_id = ${context.userId}
      `;
      return { id: data.id };
    }
    const rows = await sql<{ id: number }>`
      insert into important_notes (user_id, kind, body, image)
      values (${context.userId}, ${kind}, ${body}, ${image})
      returning id
    `;
    return { id: rows[0].id };
  });

export const deleteImportantNote = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await guard(context.userId, "notes");
    await sql`delete from important_notes where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });
