import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDelete } from "@/components/confirm-delete";
import { DataTable } from "@/components/data-table";
import { EntitySelect } from "@/components/entity-select";
import { Guard } from "@/components/guard";
import { RowActions } from "@/components/icon-btn";
import { SectionTabs, tabPanel } from "@/components/invoice-ui";
import { useAppData } from "@/components/layout/app-shell";
import { MoneyInput } from "@/components/money-input";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteAccount, saveAccount } from "@/lib/api/finance";
import { saveCurrency } from "@/lib/api/setup";
import { emptyNum, formatMoneyInt, formatMoneySymbol, parseAmount } from "@/lib/format";
import { canWrite } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";
import type { Account } from "@/lib/types";

export const Route = createFileRoute("/_app/finance/accounts")({ component: Page });

function Page() {
  return (
    <Guard area="accounts">
      <Accounts />
    </Guard>
  );
}

function Accounts() {
  const { data } = useAppData();
  const writable = canWrite(data?.profile?.role, "accounts");
  const shop = data?.settings.productionEnabled === false;
  const hideParties = shop || data?.settings.productionEnabled !== false;
  const all = data?.catalogs.accounts ?? [];
  const cash = all.filter((a) => a.kind !== "counterparty");
  const parties = all.filter((a) => a.kind === "counterparty");
  const [tab, setTab] = useState<"cash" | "party">("cash");
  const [edit, setEdit] = useState<Account | "new" | null>(null);
  const [del, setDel] = useState<Account | null>(null);

  return (
    <div>
      <PageHeader title="دخل" canAdd={writable} onAdd={() => setEdit("new")} />
      <SectionTabs
        value={hideParties ? "cash" : tab}
        onChange={setTab}
        tabs={
          hideParties
            ? [{ id: "cash", label: "دخل", color: "a" }]
            : [
                { id: "cash", label: "دخل", color: "a" },
                { id: "party", label: "طرف حساب‌ها نقدی", color: "b" },
              ]
        }
      />
      {hideParties || tab === "cash" ? (
        <div className={tabPanel("a")}>
          <DataTable
            tone="c"
            rows={cash}
            rowKey={(r) => r.id}
            excel="دخل"
            columns={[
              { header: "نام حساب", cell: (r) => r.name },
              { header: "ارز", cell: (r) => `${r.currencyName} (${r.currencySymbol})` },
              {
                header: "موجودی اولیه",
                cell: (r) => <span className="tabular-nums">{formatMoneySymbol(r.openingBalance, r.currencySymbol)}</span>,
              },
              {
                header: "موجودی فعلی",
                cell: (r) => <span className="tabular-nums font-medium">{formatMoneySymbol(r.balance, r.currencySymbol)}</span>,
              },
              {
                header: "",
                cell: (r) => (
                  <RowActions canWrite={writable} onEdit={() => setEdit(r)} onDelete={() => setDel(r)} />
                ),
              },
            ]}
          />
        </div>
      ) : (
        <div className={tabPanel("b")}>
          <DataTable
            tone="c"
            rows={parties}
            rowKey={(r) => r.id}
            excel="طرف حساب‌ها نقدی"
            columns={[
              { header: "نام طرف حساب", cell: (r) => r.name },
              { header: "ارز", cell: (r) => `${r.currencyName} (${r.currencySymbol})` },
              {
                header: "طلب شرکت",
                cell: (r) => (
                  <span className="tabular-nums">
                    {formatMoneyInt(Math.max(0, r.balance))} {r.currencySymbol}
                  </span>
                ),
              },
              {
                header: "بدهی شرکت",
                cell: (r) => (
                  <span className="tabular-nums">
                    {formatMoneyInt(Math.max(0, -r.balance))} {r.currencySymbol}
                  </span>
                ),
              },
              {
                header: "",
                cell: (r) => (
                  <RowActions canWrite={writable} onEdit={() => setEdit(r)} onDelete={() => setDel(r)} />
                ),
              },
            ]}
          />
        </div>
      )}
      {edit ? (
        tab === "party" || (edit !== "new" && edit.kind === "counterparty") ? (
          <CashPartyModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
        ) : (
          <AccountModal initial={edit === "new" ? null : edit} onClose={() => setEdit(null)} />
        )
      ) : null}
      <ConfirmDelete
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await deleteAccount({ data: { id: del.id } });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }}
      />
    </div>
  );
}

function AccountModal({ initial, onClose }: { initial: Account | null; onClose: () => void }) {
  const { data } = useAppData();
  const afn = data?.catalogs.currencies.find((c) => c.name === "افغانی")?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [currencyId, setCurrencyId] = useState<number | null>(initial?.currencyId ?? afn ?? data?.catalogs.currencies[0]?.id ?? null);
  const [opening, setOpening] = useState(emptyNum(initial?.openingBalance));
  const [addCur, setAddCur] = useState(false);
  const [newCur, setNewCur] = useState({ name: "", symbol: "", rate: "1" });

  return (
    <>
      <Modal open title={initial ? "ویرایش دخل" : "افزودن دخل"} onClose={onClose}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!currencyId) throw new Error("ارز را انتخاب کنید");
            await saveAccount({
              data: {
                id: initial?.id,
                name,
                currencyId,
                openingBalance: parseAmount(opening),
                kind: "cash",
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            onClose();
            toast.success("ثبت شد");
          }}
        >
          <Field label="نام حساب">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="ارز">
            <EntitySelect
              value={currencyId}
              options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
              onChange={(id) => setCurrencyId(id == null ? null : Number(id))}
              onAdd={() => setAddCur(true)}
            />
          </Field>
          <Field label="موجودی اولیه">
            <MoneyInput value={opening} onChange={setOpening} />
          </Field>
          <Button type="submit">ثبت</Button>
        </form>
      </Modal>
      <Modal open={addCur} title="افزودن ارز" onClose={() => setAddCur(false)}>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await saveCurrency({
              data: {
                name: newCur.name,
                symbol: newCur.symbol,
                rateToBase: parseAmount(newCur.rate),
              },
            });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            setCurrencyId(res.id);
            setAddCur(false);
          }}
        >
          <Field label="نام">
            <Input value={newCur.name} onChange={(e) => setNewCur({ ...newCur, name: e.target.value })} required />
          </Field>
          <Field label="نماد">
            <Input value={newCur.symbol} onChange={(e) => setNewCur({ ...newCur, symbol: e.target.value })} required />
          </Field>
          <Field label="نرخ به افغانی">
            <MoneyInput unlimitedDecimals value={newCur.rate} onChange={(rate) => setNewCur({ ...newCur, rate })} />
          </Field>
          <Button type="submit">ثبت</Button>
        </form>
      </Modal>
    </>
  );
}

function CashPartyModal({ initial, onClose }: { initial: Account | null; onClose: () => void }) {
  const { data } = useAppData();
  const afn = data?.catalogs.currencies.find((c) => c.name === "افغانی")?.id;
  const [name, setName] = useState(initial?.name ?? "");
  const [currencyId, setCurrencyId] = useState<number | null>(
    initial?.currencyId ?? afn ?? data?.catalogs.currencies[0]?.id ?? null,
  );
  const [side, setSide] = useState<"recv" | "pay">(initial && initial.openingBalance < 0 ? "pay" : "recv");
  const [amount, setAmount] = useState(emptyNum(initial ? Math.abs(initial.openingBalance) : undefined));

  return (
    <Modal open title={initial ? "ویرایش طرف حساب نقدی" : "افزودن طرف حساب نقدی"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!currencyId) throw new Error("ارز را انتخاب کنید");
          const mag = parseAmount(amount);
          await saveAccount({
            data: {
              id: initial?.id,
              name,
              currencyId,
              openingBalance: side === "recv" ? mag : -mag,
              kind: "counterparty",
            },
          });
          await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          onClose();
          toast.success("ثبت شد");
        }}
      >
        <Field label="نام طرف حساب">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="ارز">
          <EntitySelect
            value={currencyId}
            options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
            onChange={(id) => setCurrencyId(id == null ? null : Number(id))}
          />
        </Field>
        <div className="space-y-1.5">
          <span className="block text-xs font-medium leading-none sm:text-sm">نوع</span>
          <div className="space-y-2 rounded-md border border-border bg-surface-2 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cash-party-side"
                className="accent-primary"
                checked={side === "recv"}
                onChange={() => setSide("recv")}
              />
              طلب شرکت
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="cash-party-side"
                className="accent-primary"
                checked={side === "pay"}
                onChange={() => setSide("pay")}
              />
              بدهی شرکت
            </label>
          </div>
        </div>
        <Field label={side === "recv" ? "طلب شرکت" : "بدهی شرکت"}>
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}
