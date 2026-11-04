export type Role = "supervisor" | "accountant" | "seller";

export type Profile = {
  userId: string;
  displayName: string;
  role: Role;
};

export type Company = {
  userId: string;
  name: string;
  logo: string | null;
  licenseNo: string;
  tin: string;
  address: string;
  phone1: string;
  phone2: string;
  phone3: string;
  email: string;
};

export type Currency = {
  id: number;
  name: string;
  symbol: string;
  rateToBase: number;
};

export type Named = { id: number; name: string };

export type WageRate = {
  id: number;
  jobTypeId: number;
  jobTypeName: string;
  productModel: string;
  wagePerUnit: number;
  registeredAt: string;
  notes: string;
};

export function wageTotalsByModel(rates: WageRate[]): { productModel: string; total: number }[] {
  const map = new Map<string, number>();
  for (const r of rates) {
    const key = r.productModel.trim() || "—";
    map.set(key, (map.get(key) ?? 0) + r.wagePerUnit);
  }
  return [...map.entries()]
    .map(([productModel, total]) => ({ productModel, total }))
    .sort((a, b) => a.productModel.localeCompare(b.productModel, "fa"));
}

export type PartyCategory = { id: number; kind: string; name: string };

export type WorkerEmployment = "contract" | "salaried";

export const EMPLOYMENT_LABELS: Record<WorkerEmployment, string> = {
  contract: "کانتراتی",
  salaried: "ثابت",
};

export function parseEmployment(value: string | null | undefined): WorkerEmployment {
  return value === "salaried" ? "salaried" : "contract";
}

export type Party = {
  id: number;
  kind: "customer" | "vendor" | "worker" | "other";
  name: string;
  phone: string;
  categoryId: number | null;
  categoryName: string;
  notes: string;
  jobTypeId: number | null;
  jobTypeName: string;
  startDate: string;
  address: string;
  currencyId: number | null;
  currencyName: string;
  stageId: number | null;
  stageName: string;
  employment: WorkerEmployment;
  salary: number;
};

export type Item = {
  id: number;
  name: string;
  typeId: number | null;
  typeName: string;
  categoryId: number | null;
  categoryName: string;
  unitId: number | null;
  unitName: string;
  kind: "product" | "raw";
  image: string | null;
  minQty: number;
  salePrice: number;
  purchasePrice: number;
  notes: string;
};

export type ItemCategory = { id: number; name: string; kind: Item["kind"] };

export type BomLine = {
  rawItemId: number;
  rawItemName: string;
  quantity: number;
  unitId: number | null;
  unitName: string;
};

export type StockCard = {
  itemId: number;
  name: string;
  categoryId: number | null;
  categoryName: string;
  unitId: number | null;
  unitName: string;
  image: string | null;
  minQty: number;
  qty: number;
  unitCost: number;
  valueBase: number;
  kind: Item["kind"];
  salePrice: number;
  purchasePrice: number;
};

export type ItemOverhead = {
  id: number;
  itemId: number;
  title: string;
  amount: number;
};

export type ProductionOverheadType = {
  id: number;
  title: string;
  amount: number;
};

export type InventoryData = {
  products: StockCard[];
  raw: StockCard[];
  workerRaw: StockCard[];
  bomByProduct: Record<number, BomLine[]>;
  overheadsByProduct: Record<number, ItemOverhead[]>;
};

export type ProductionStage = { id: number; name: string; sortOrder: number };

export function isFirstStage(stages: ProductionStage[], stageId: number | null | undefined): boolean {
  if (!stages.length) return true;
  if (stageId == null) return false;
  const min = Math.min(...stages.map((s) => s.sortOrder));
  return stages.some((s) => s.id === stageId && s.sortOrder === min);
}

export function isLastStage(stages: ProductionStage[], stageId: number | null | undefined): boolean {
  if (!stages.length) return true;
  if (stageId == null) return true;
  const max = Math.max(...stages.map((s) => s.sortOrder));
  return stages.some((s) => s.id === stageId && s.sortOrder === max);
}

export function stageRoleLabel(stages: ProductionStage[], stage: ProductionStage): string {
  if (!stages.length) return "";
  const min = Math.min(...stages.map((s) => s.sortOrder));
  const max = Math.max(...stages.map((s) => s.sortOrder));
  if (stage.sortOrder === min && stage.sortOrder === max) return "اول و آخر";
  if (stage.sortOrder === min) return "مرحله اول";
  if (stage.sortOrder === max) return "مرحله آخر";
  return "میانی";
}

export type WorkOrder = {
  id: number;
  workerId: number | null;
  workerName: string;
  productId: number;
  productName: string;
  quantity: number;
  deliveredQty: number;
  remaining: number;
  occurredOn: string;
  notes: string;
  invoiceNo: string;
  stageId: number | null;
  stageName: string;
  rootId: number | null;
  isLastStage: boolean;
};

export type WorkerPayment = {
  id: number;
  workerId: number;
  workerName: string;
  amount: number;
  occurredOn: string;
  notes: string;
  invoiceNo: string;
  accountId: number | null;
  accountName: string;
};

export type WorkerModelAgg = {
  productId: number;
  productName: string;
  qtyOrdered: number;
  qtyDelivered: number;
  wagePerUnit: number;
  wageTotal: number;
};

export type WorkerDeliveryLine = {
  id: number;
  workOrderId: number;
  workerId: number;
  rootId: number;
  productId: number;
  productName: string;
  quantity: number;
  occurredOn: string;
  notes: string;
  toWorkerId: number | null;
  toWorkerName: string;
  toWorkOrderId: number | null;
  toWarehouse: boolean;
  stageId: number | null;
  wagePerUnit: number;
  wageTotal: number;
};

export type WorkerLedger = {
  worker: Party;
  models: WorkerModelAgg[];
  deliveries: WorkerDeliveryLine[];
  payments: WorkerPayment[];
  workTotal: number;
  paidTotal: number;
  owed: number;
};

export type ExpenseCategory = { id: number; name: string; kind: "misc" | "recurring" };

export type RecurringCadence = "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly";

export const CADENCE_LABELS: Record<RecurringCadence, string> = {
  weekly: "هفتگی",
  monthly: "ماهوار",
  quarterly: "سه‌ماهه",
  semiannual: "شش‌ماهه",
  yearly: "سالانه",
};

export const CADENCE_OPTIONS: RecurringCadence[] = [
  "weekly",
  "monthly",
  "quarterly",
  "semiannual",
  "yearly",
];

export function parseCadence(value: string | null | undefined): RecurringCadence {
  if (value && value in CADENCE_LABELS) return value as RecurringCadence;
  return "monthly";
}

export type RecurringDueAnchor = "start" | "end";

export const DUE_ANCHOR_LABELS: Record<RecurringDueAnchor, string> = {
  start: "اول دوره",
  end: "آخر دوره",
};

export function parseDueAnchor(value: string | null | undefined): RecurringDueAnchor {
  return value === "end" ? "end" : "start";
}

export type RecurringExpense = {
  id: number;
  title: string;
  amount: number;
  currencyId: number;
  currencySymbol: string;
  categoryId: number | null;
  categoryName: string;
  startOn: string;
  cadence: RecurringCadence;
  dueAnchor: RecurringDueAnchor;
  notes: string;
  accountId: number | null;
  accountName: string;
  partyId: number | null;
  partyName: string;
  workerId: number | null;
};


export type RecurringDue = {
  id: number | null;
  recurringId: number;
  title: string;
  amount: number;
  currencyId: number;
  currencySymbol: string;
  period: string;
  dueOn: string;
  status: "unpaid" | "paid";
  partyId: number | null;
  partyName: string;
  workerId: number | null;
};


export type AccountKind = "cash" | "counterparty";

export type Account = {
  id: number;
  name: string;
  currencyId: number;
  currencyName: string;
  currencySymbol: string;
  openingBalance: number;
  balance: number;
  kind: AccountKind;
};

export function parseAccountKind(value: string | null | undefined): AccountKind {
  return value === "counterparty" ? "counterparty" : "cash";
}

export type Transfer = {
  id: number;
  fromAccountId: number;
  fromAccountName: string;
  toAccountId: number;
  toAccountName: string;
  amount: number;
  occurredOn: string;
  notes: string;
};

export type CapitalMove = {
  id: number;
  kind: "add" | "withdraw";
  accountId: number;
  accountName: string;
  currencyId: number;
  currencySymbol: string;
  amount: number;
  occurredOn: string;
  notes: string;
};

export type OpeningCash = {
  id: number;
  accountId: number;
  accountName: string;
  currencyId: number;
  currencySymbol: string;
  amount: number;
  occurredOn: string;
  notes: string;
};

export type OpeningStock = {
  id: number;
  kind: "finished" | "raw";
  itemName: string;
  warehouseName: string;
  quantity: number;
  valueBase: number;
  salePrice: number;
  unitCost: number;
  occurredOn: string;
  notes: string;
};

export type Purchase = {
  id: number;
  vendorId: number | null;
  vendorName: string;
  itemId: number | null;
  itemName: string;
  quantity: number;
  receivedQty: number;
  unitId: number | null;
  unitName: string;
  unitPrice: number;
  currencyId: number;
  currencySymbol: string;
  accountId: number | null;
  accountName: string;
  warehouseName: string;
  occurredOn: string;
  notes: string;
  total: number;
  invoiceNo: string;
  status: DocStatus;
  itemKind: Item["kind"];
  invoiceId: number | null;
  lineNo: number;
};

export type Sale = {
  id: number;
  customerId: number | null;
  customerName: string;
  itemId: number | null;
  itemName: string;
  quantity: number;
  unitId: number | null;
  unitName: string;
  unitPrice: number;
  currencyId: number;
  currencySymbol: string;
  accountId: number | null;
  accountName: string;
  occurredOn: string;
  notes: string;
  total: number;
  invoiceNo: string;
  status: DocStatus;
  itemKind: Item["kind"];
  invoiceId: number | null;
  lineNo: number;
};

export type Expense = {
  id: number;
  title: string;
  amount: number;
  currencyId: number;
  currencySymbol: string;
  accountId: number | null;
  accountName: string;
  occurredOn: string;
  notes: string;
  categoryId: number | null;
  categoryName: string;
  partyId: number | null;
  partyName: string;
  asDebt: boolean;
};

export type DocStatus = "final" | "draft" | "void";

export type CalendarMode = "jalali" | "gregorian";
export type ThemeMode = "light" | "dark";

export type ColorPreset = {
  id: string;
  label: string;
  theme: ThemeMode;
  fontColor: string;
  primaryColor: string;
  bgColor: string;
  accentColor: string;
  dangerColor: string;
};

export type AppSettings = {
  theme: ThemeMode;
  fontSize: number;
  fontFamily: string;
  fontColor: string;
  primaryColor: string;
  bgColor: string;
  accentColor: string;
  dangerColor: string;
  listColor: string;
  cardTint: boolean;
  cardTintStrength: number;
  calendar: CalendarMode;
  roleCodes: Record<Role, string>;
  colorPresets: ColorPreset[];
  productionEnabled: boolean;
};

export type StaffUser = {
  id: number;
  displayName: string;
  role: Role;
  isOwner: boolean;
};

export type PartySummary = {
  id: number;
  name: string;
  invoicedBase: number;
  paidBase: number;
  remainingBase: number;
  prepaid?: boolean;
};

export type PartyPayment = {
  id: number;
  partyId: number;
  partyName: string;
  partyKind: Party["kind"] | "";
  categoryName: string;
  kind: "receipt" | "payment";
  amount: number;
  amountBase: number;
  currencyId: number;
  currencySymbol: string;
  fxRate: number;
  accountId: number | null;
  accountName: string;
  receiptNo: string;
  occurredOn: string;
  notes: string;
};

export type InvoiceLine = {
  id: number;
  itemId: number | null;
  itemName: string;
  quantity: number;
  receivedQty: number;
  unitId: number | null;
  unitName: string;
  unitPrice: number;
  notes: string;
  itemKind: Item["kind"];
  lineNo: number;
};

export type ReceiveStatus = "in_transit" | "arrived";

export type PurchaseInvoice = {
  id: number;
  vendorId: number | null;
  vendorName: string;
  invoiceNo: string;
  occurredOn: string;
  expectedOn: string;
  currencyId: number;
  currencySymbol: string;
  fxEnabled: boolean;
  fxRate: number;
  paidAmount: number;
  accountId: number | null;
  accountName: string;
  notes: string;
  receiveStatus: ReceiveStatus;
  lines: InvoiceLine[];
  total: number;
  totalBase: number;
  remainingBase: number;
};

export type SaleInvoice = {
  id: number;
  customerId: number | null;
  customerName: string;
  invoiceNo: string;
  occurredOn: string;
  currencyId: number;
  currencySymbol: string;
  fxEnabled: boolean;
  fxRate: number;
  receivedAmount: number;
  receivedFxRate: number;
  accountId: number | null;
  accountName: string;
  notes: string;
  kind: Item["kind"];
  closed: boolean;
  refundAmount: number;
  refundAccountId: number | null;
  cashIncludedBase: number;
  lines: InvoiceLine[];
  total: number;
  totalBase: number;
  remainingBase: number;
};

export type DashboardAlert = { kind: "warn" | "info" | "danger"; text: string; title?: string; section: string };

export type DashboardData = {
  cashBase: number;
  cashAccounts: {
    name: string;
    balance: number;
    balanceBase: number;
    currencySymbol: string;
    isBase: boolean;
  }[];
  salesBase: number;
  cogsBase: number;
  expenseBase: number;
  profitBase: number;
  receivableBase: number;
  customerReceivableBase: number;
  cashTakeBase: number;
  prepaymentBase: number;
  payableBase: number;
  vendorPayableBase: number;
  expenseDebtBase: number;
  recurringDueBase: number;
  salaryDueBase: number;
  workerWagePayableBase: number;
  cashPartyReceivableBase: number;
  cashPartyPayableBase: number;
  cashParties: {
    name: string;
    balance: number;
    balanceBase: number;
    currencySymbol: string;
    currencyName: string;
    isBase: boolean;
  }[];
  warehouses: { name: string; qty: number; valueBase: number }[];
  productSales: { name: string; qty: number; amountBase: number; occurredOn: string }[];
  alerts: DashboardAlert[];
  noteTexts: string[];
  noteImageCount: number;
};

export type WarehouseStock = {
  warehouseName: string;
  items: { name: string; qty: number; valueBase: number; kind: Item["kind"] }[];
};

export type PartyBalance = {
  partyName: string;
  invoicedBase: number;
  paidBase: number;
  remainingBase: number;
  byCurrency: { symbol: string; invoiced: number; paid: number; remaining: number }[];
};

export type SaleLedgerRow = {
  id: number;
  occurredOn: string;
  invoiceNo: string;
  itemKind: Item["kind"];
  itemKindLabel: string;
  itemName: string;
  quantity: number;
  unitPriceBase: number;
  totalBase: number;
};

export type PurchaseLedgerRow = {
  id: number;
  occurredOn: string;
  invoiceNo: string;
  itemKind: Item["kind"];
  itemKindLabel: string;
  itemName: string;
  quantity: number;
  unitPriceBase: number;
  totalBase: number;
};

export type ModelSummary = {
  itemId: number;
  itemName: string;
  qtySold: number;
  amountSold: number;
  stockQty: number;
  unitCost: number;
};

export type Catalogs = {
  currencies: Currency[];
  units: Named[];
  jobTypes: Named[];
  partyCategories: PartyCategory[];
  itemCategories: ItemCategory[];
  itemTypes: Named[];
  items: Item[];
  warehouses: (Named & { shopOnly?: boolean })[];
  accounts: Account[];
  parties: Party[];
  productionStages: ProductionStage[];
  productionOverheads: ProductionOverheadType[];
};

export type Bootstrap = {
  profile: Profile | null;
  company: Company | null;
  catalogs: Catalogs;
  settings: AppSettings;
  staff: StaffUser[];
  needsSessionRole: boolean;
};

export const ROLE_LABELS: Record<Role, string> = {
  supervisor: "ناظر",
  accountant: "حسابدار",
  seller: "فروشنده",
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  fontSize: 16,
  fontFamily: "Vazirmatn",
  fontColor: "#f7f2f6",
  primaryColor: "#ff2d6a",
  bgColor: "#07040c",
  accentColor: "#f4c27a",
  dangerColor: "#ff4d4d",
  listColor: "#3a2433",
  cardTint: true,
  cardTintStrength: 40,
  calendar: "jalali",
  roleCodes: { supervisor: "", accountant: "", seller: "" },
  colorPresets: [],
  productionEnabled: true,
};

export const ITEM_KIND_LABEL: Record<Item["kind"], string> = {
  product: "کالای تولیدشده",
  raw: "مواد خام",
};

export const PARTY_KIND_LABEL: Record<Party["kind"], string> = {
  customer: "مشتری",
  vendor: "فروشنده",
  worker: "کارگر",
  other: "سایر",
};
