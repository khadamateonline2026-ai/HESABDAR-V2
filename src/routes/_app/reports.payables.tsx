import { createFileRoute } from "@tanstack/react-router";
import { PartyStatement } from "@/components/party-statement";

export const Route = createFileRoute("/_app/reports/payables")({
  component: function Payables() {
    return (
      <PartyStatement
        kind="vendor"
        title="بدهی‌ها"
        selectLabel="طلب‌کار"
        invoicedLabel="مجموع خرید"
        paidLabel="مجموع پرداختی"
        invoiceKindHeader="نوع مواد خام"
        paymentTitle="پرداختی‌ها"
        paymentKind="payment"
        addPaymentLabel="ثبت پرداخت"
        remainingLabel="بدهی باقی"
        summaryTitle="گزارش کلی بدهی‌ها"
        showDateFilter
      />
    );
  },
});
