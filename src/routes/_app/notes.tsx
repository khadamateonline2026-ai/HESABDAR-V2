import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAppData } from "@/components/layout/app-shell";
import { deleteImportantNote, listImportantNotes, saveImportantNote, type ImportantNote } from "@/lib/api/notes";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";

export const Route = createFileRoute("/_app/notes")({ component: Page });

async function readPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function Page() {
  return (
    <Guard area="notes">
      <NotesPage />
    </Guard>
  );
}

function NotesPage() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "notes");
  const list = useQuery({ queryKey: ["important-notes"], queryFn: () => listImportantNotes() });
  const [edit, setEdit] = useState<ImportantNote | "new" | null>(null);
  const [del, setDel] = useState<ImportantNote | null>(null);

  return (
    <div>
      <PageHeader title="یادداشت‌های مهم" canAdd={writable} onAdd={() => setEdit("new")} />
      <ul className="space-y-2">
        {(list.data ?? []).map((n) => (
          <li key={n.id} className="rounded-md border border-border bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              {n.kind === "image" && n.image ? (
                <img src={n.image} alt="" className="max-h-48 min-w-0 flex-1 rounded-sm object-contain" />
              ) : (
                <p className="min-w-0 flex-1 text-sm leading-6 whitespace-pre-wrap">{n.body}</p>
              )}
              {writable ? (
                <div className="shrink-0">
                  <RowActions canWrite onEdit={() => setEdit(n)} onDelete={() => setDel(n)} />
                </div>
              ) : null}
            </div>
          </li>
        ))}
        {!list.data?.length ? <p className="text-sm text-muted">یادداشتی ثبت نشده است</p> : null}
      </ul>
      {edit ? <NoteModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteImportantNote({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["important-notes"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />
    </div>
  );
}

function NoteModal({ initial, onClose }: { initial: ImportantNote | null; onClose: () => void }) {
  const [kind, setKind] = useState<"text" | "image">(initial?.kind ?? "text");
  const [body, setBody] = useState(initial?.body ?? "");
  const [image, setImage] = useState<string | null>(initial?.image ?? null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Modal open title={initial ? "ویرایش یادداشت" : "افزودن یادداشت"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await saveImportantNote({
              data: { id: initial?.id, kind, body, image },
            });
            await queryClient.invalidateQueries({ queryKey: ["important-notes"] });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success("ثبت شد");
            onClose();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "ثبت ناکام شد");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <span className="block text-xs font-medium sm:text-sm">نوع</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`h-10 rounded-md border text-sm ${kind === "text" ? "border-primary bg-primary-soft font-medium text-primary" : "border-border bg-surface"}`}
              onClick={() => setKind("text")}
            >
              متن
            </button>
            <button
              type="button"
              className={`h-10 rounded-md border text-sm ${kind === "image" ? "border-primary bg-primary-soft font-medium text-primary" : "border-border bg-surface"}`}
              onClick={() => setKind("image")}
            >
              عکس
            </button>
          </div>
        </div>
        {kind === "text" ? (
          <Field label="متن">
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} required />
          </Field>
        ) : (
          <div className="space-y-2">
            {image ? <img src={image} alt="" className="max-h-56 w-full rounded-sm object-contain" /> : null}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  setImage(await readPhoto(f));
                } catch {
                  toast.error("خواندن عکس ناکام شد");
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()}>
              {image ? "تغییر عکس" : "آپلود عکس"}
            </Button>
          </div>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? "…" : "ثبت"}
        </Button>
      </form>
    </Modal>
  );
}
