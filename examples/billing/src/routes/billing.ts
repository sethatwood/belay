import { Hono } from "hono";
import { formatMoney, sumCents, type Currency } from "../lib/money";
import { toIsoDay } from "../lib/dates";

export type InvoiceStatus = "open" | "paid" | "void";

export type LineItem = {
  description: string;
  amountCents: number;
};

export type Invoice = {
  id: string;
  customer: string;
  status: InvoiceStatus;
  currency: Currency;
  issuedAt: string;
  lines: LineItem[];
};

// The store is in memory. A real service would read a database here.
const invoices: Invoice[] = [
  {
    id: "in_1001",
    customer: "cus_acme",
    status: "paid",
    currency: "usd",
    issuedAt: "2026-08-01T00:00:00.000Z",
    lines: [
      { description: "Plan, August", amountCents: 4900 },
      { description: "Seats, 3 extra", amountCents: 1500 },
    ],
  },
  {
    id: "in_1002",
    customer: "cus_acme",
    status: "open",
    currency: "usd",
    issuedAt: "2026-09-01T00:00:00.000Z",
    lines: [{ description: "Plan, September", amountCents: 4900 }],
  },
  {
    id: "in_1003",
    customer: "cus_globex",
    status: "open",
    currency: "eur",
    issuedAt: "2026-09-03T00:00:00.000Z",
    lines: [{ description: "Plan, September", amountCents: 12000 }],
  },
];

export function listInvoices(customer?: string): Invoice[] {
  if (customer === undefined) {
    return invoices;
  }
  return invoices.filter((invoice) => invoice.customer === customer);
}

export function findInvoice(id: string): Invoice | undefined {
  return invoices.find((invoice) => invoice.id === id);
}

// The shape the routes return. Totals are computed, never stored.
function present(invoice: Invoice) {
  const totalCents = sumCents(invoice.lines.map((line) => line.amountCents));
  return {
    id: invoice.id,
    customer: invoice.customer,
    status: invoice.status,
    issuedOn: toIsoDay(new Date(invoice.issuedAt)),
    totalCents,
    total: formatMoney(totalCents, invoice.currency),
    lines: invoice.lines,
  };
}

export const billing = new Hono();

billing.get("/invoices", (c) => {
  const customer = c.req.query("customer");
  const found = listInvoices(customer);
  return c.json({ invoices: found.map(present) });
});

billing.get("/invoices/:id", (c) => {
  const invoice = findInvoice(c.req.param("id"));
  if (invoice === undefined) {
    return c.json({ error: "invoice not found" }, 404);
  }
  return c.json(present(invoice));
});
