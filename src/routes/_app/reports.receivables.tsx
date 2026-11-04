import { createFileRoute } from "@tanstack/react-router";
import { PartyStatement } from "@/components/party-statement";

export const Route = createFileRoute("/_app/reports/receivables")({
  component: function Receivables() {
    return (
      <PartyStatement
        kind="customer"
        title="طلبات"
        selectLabel="بدهکار"
        invoicedLabel="مجموع فروش"
        paidLabel="مجموع دریافتی"
        invoiceKindHeader="نوع کالا"
        paymentTitle="دریافتی‌ها"
        paymentKind="receipt"
        addPaymentLabel="ثبت دریافت"
        remainingLabel="طلب باقی"
        summaryTitle="گزارش کلی طلبات"
        showDateFilter
      />
    );
  },
});
