import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AddNameModal } from "@/components/add-name-modal";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { useAppData } from "@/components/layout/app-shell";
import { PartyFormModal } from "@/components/party-form";
import { PageHeader } from "@/components/page-header";
import { CategoryBar } from "@/components/warehouse-ui";
import { savePartyCategory, deleteParty, deletePartyCategory } from "@/lib/api/setup";
import { DateText } from "@/components/date-picker";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Party } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/setup/parties")({ component: Page });

type Kind = "customer" | "vendor" | "worker" | "other";

function Page() {
  return (
    <Guard area="parties">
      <PartiesScreen />
    </Guard>
  );
}

function PartiesScreen() {
  const { data } = useAppData();
  const role = data?.profile?.role;
  const seller = role === "seller";
  const [kind, setKind] = useState<Kind>(seller ? "worker" : "customer");
  const writable = canWrite(role, kind === "worker" ? "workers" : "parties");
  const parties = (data?.catalogs.parties ?? []).filter((p) => p.kind === kind);
  const cats = (data?.catalogs.partyCategories ?? []).filter((c) => c.kind === kind);
  const [modal, setModal] = useState<Party | "new" | null>(null);
  const [del, setDel] = useState<Party | null>(null);
  const [catModal, setCatModal] = useState<"new" | { id: number; name: string } | null>(null);
  const [delCat, setDelCat] = useState<{ id: number; name: string } | null>(null);
  const [catFilter, setCatFilter] = useState<number | "all">("all");

  const tabs: { id: Kind; label: string; border: string }[] = seller
    ? [{ id: "worker", label: "کارگران", border: "border-tab-a" }]
    : [
        { id: "customer", label: "مشتریان", border: "border-tab-a" },
        { id: "vendor", label: "فروشنده‌ها", border: "border-tab-b" },
        { id: "worker", label: "کارگران", border: "border-tab-c" },
        { id: "other", label: "سایر", border: "border-tab-a" },
      ];

  return (
    <div>
      <PageHeader title="طرف حساب‌ها" canAdd={writable} onAdd={() => setModal("new")} />
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setKind(t.id);
              setCatFilter("all");
            }}
            className={cn(
              "rounded-md border-2 bg-surface px-4 py-2 text-sm font-medium",
              t.border,
              kind === t.id ? "bg-surface-2" : "opacity-80",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {kind !== "worker" ? (
        <CategoryBar
          categories={cats}
          value={catFilter}
          onChange={setCatFilter}
          writable={writable}
          canEdit
          onAdd={() => setCatModal("new")}
          onEdit={(c) => setCatModal(c)}
          onDelete={(c) => setDelCat(c)}
        />
      ) : null}

      <DataTable
        tone="c"
        rows={
          kind === "worker" || catFilter === "all"
            ? parties
            : parties.filter((p) => p.categoryId === catFilter)
        }
        rowKey={(r) => r.id}
        columns={[
          { header: "نام", cell: (r) => r.name },
          { header: "تلفن", cell: (r) => r.phone || "—" },
          kind === "worker"
            ? { header: "نوع وظیفه", cell: (r) => r.jobTypeName || "—" }
            : { header: "دسته‌بندی", cell: (r) => r.categoryName || "—" },
          kind === "worker"
            ? {
                header: "تاریخ شروع",
                cell: (r) =>
                  r.startDate ? <DateText iso={r.startDate} /> : "—",
              }
            : { header: "یادداشت", cell: (r) => r.notes || "—" },
          {
            header: "",
            cell: (r) => (
              <RowActions canWrite={writable} onEdit={() => setModal(r)} onDelete={() => setDel(r)} />
            ),
          },
        ]}
      />

      {modal ? (
        <PartyFormModal
          kind={kind}
          initial={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
        />
      ) : null}

      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteParty({ data: { id: del.id, kind: del.kind } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          toast.success("حذف شد");
        }}
      />

      <AddNameModal
        open={catModal === "new"}
        title="افزودن دسته‌بندی"
        onClose={() => setCatModal(null)}
        onSave={async (name) => {
          await savePartyCategory({ data: { kind: kind === "worker" ? "other" : kind, name } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
      {catModal && catModal !== "new" ? (
        <AddNameModal
          open
          title="ویرایش دسته‌بندی"
          onClose={() => setCatModal(null)}
          onSave={async (name) => {
            await savePartyCategory({
              data: { id: catModal.id, kind: kind === "worker" ? "other" : kind, name },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          }}
        />
      ) : null}
      <ConfirmDelete
        open={Boolean(delCat)}
        onClose={() => setDelCat(null)}
        onConfirm={async () => {
          if (!delCat) return;
          await deletePartyCategory({ data: { id: delCat.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          setCatFilter("all");
        }}
      />
    </div>
  );
}
