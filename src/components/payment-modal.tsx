import { useState } from "react";
import { toast } from "sonner";
import { DateField } from "@/components/date-picker";
import { CurrencyMatchNote } from "@/components/currency-match";
import { EntitySelect } from "@/components/entity-select";
import { AfAmount } from "@/components/invoice-ui";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { useAppData } from "@/components/layout/app-shell";
import { savePartyPayment } from "@/lib/api/reports";
import { saveTransfer } from "@/lib/api/finance";
import { convertAmount, emptyNum, parseAmount, todayIso } from "@/lib/format";
import { queryClient } from "@/lib/query-client";

export function PaymentModal({
  kind,
  partyId,
  onClose,
  title,
}: {
  kind: "receipt" | "payment";
  partyId: number;
  onClose: () => void;
  title?: string;
}) {
  const { data } = useAppData();
  const afn = data?.catalogs.currencies.find((c) => c.name === "افغانی");
  const startCur = afn ?? data?.catalogs.currencies[0];
  const [amount, setAmount] = useState("");
  const [currencyId, setCurrency] = useState<number | null>(startCur?.id ?? null);
  const [fxRate, setFxRate] = useState(emptyNum(startCur?.rateToBase || 1));
  const cashAccountId = partyId < 0 ? -partyId : null;
  const tills = (data?.catalogs.accounts ?? []).filter((a) => a.kind !== "counterparty");
  const startAcc = tills[0] ?? data?.catalogs.accounts[0];
  const [accountId, setAccount] = useState<number | null>(startAcc?.id ?? null);
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const cur = (data?.catalogs.currencies ?? []).find((c) => c.id === currencyId);
  const amountN = parseAmount(amount);
  const liveRate = parseAmount(fxRate) || cur?.rateToBase || 1;
  const amountBase = amountN * liveRate;
  const accountOptions = cashAccountId
    ? tills.map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }))
    : (data?.catalogs.accounts ?? []).map((a) => ({ id: a.id, label: `${a.name} (${a.currencySymbol})` }));

  return (
    <Modal open title={title ?? (kind === "receipt" ? "ثبت دریافت" : "ثبت پرداخت")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!currencyId) return;
          try {
            if (cashAccountId != null) {
              if (!accountId || accountId === cashAccountId) throw new Error("حساب دخل را انتخاب کنید");
              const fromId = kind === "receipt" ? cashAccountId : accountId;
              const toId = kind === "receipt" ? accountId : cashAccountId;
              const fromAcc = (data?.catalogs.accounts ?? []).find((a) => a.id === fromId);
              const fromRate =
                (data?.catalogs.currencies ?? []).find((c) => c.id === fromAcc?.currencyId)?.rateToBase || 1;
              const xferAmount = convertAmount(amountN, liveRate, fromRate);
              await saveTransfer({
                data: {
                  fromAccountId: fromId,
                  toAccountId: toId,
                  amount: xferAmount,
                  occurredOn: date,
                  notes,
                },
              });
            } else {
              await savePartyPayment({
                data: {
                  partyId,
                  kind,
                  amount: amountN,
                  currencyId,
                  fxRate: liveRate,
                  accountId,
                  occurredOn: date,
                  notes,
                },
              });
            }
            await queryClient.invalidateQueries({ queryKey: ["party-statement"] });
            await queryClient.invalidateQueries({ queryKey: ["outstanding"] });
            await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
            await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
            toast.success("ثبت شد");
            onClose();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "خطا");
          }
        }}
      >
        <Field label="مبلغ">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-end gap-2">
          <Field label="ارز">
            <EntitySelect
              value={currencyId}
              options={(data?.catalogs.currencies ?? []).map((c) => ({ id: c.id, label: `${c.name} (${c.symbol})` }))}
              onChange={(id) => {
                const n = id == null ? null : Number(id);
                setCurrency(n);
                const next = (data?.catalogs.currencies ?? []).find((c) => c.id === n);
                setFxRate(emptyNum(next?.rateToBase || 1));
              }}
            />
          </Field>
          <Field label="نرخ">
            <MoneyInput value={fxRate} onChange={setFxRate} />
          </Field>
        </div>
        {cur && !cur.symbol.includes("؋") && amountN > 0 ? (
          <div className="flex items-center justify-between rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm">
            <span className="text-muted">معادل افغانی</span>
            <AfAmount value={amountBase} size="sm" />
          </div>
        ) : null}
        <Field label="حساب">
          <EntitySelect
            value={accountId}
            options={accountOptions}
            onChange={(id) => {
              const n = id == null ? null : Number(id);
              setAccount(n);
            }}
          />
        </Field>
        <CurrencyMatchNote
          accounts={data?.catalogs.accounts ?? []}
          currencies={data?.catalogs.currencies ?? []}
          accountId={accountId}
          currencyId={currencyId}
          amount={amount}
          fromRate={liveRate}
          verb={kind === "payment" ? "کسر" : "افزودن"}
        />
        <Field label="تاریخ">
          <DateField value={date} onChange={setDate} />
        </Field>
        <Field label="یادداشت">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Button type="submit">ثبت</Button>
      </form>
    </Modal>
  );
}
