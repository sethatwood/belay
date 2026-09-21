import { describe, it, expect } from "vitest";
import { app } from "../app";

type InvoiceView = {
  id: string;
  customer: string;
  status: string;
  issuedOn: string;
  totalCents: number;
  total: string;
};

describe("GET /billing/invoices", () => {
  it("lists every invoice with a computed total", async () => {
    const res = await app.request("/billing/invoices");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { invoices: InvoiceView[] };
    expect(body.invoices).toHaveLength(3);
    expect(body.invoices[0]?.id).toBe("in_1001");
    expect(body.invoices[0]?.total).toBe("$64.00");
  });

  it("filters by customer", async () => {
    const res = await app.request("/billing/invoices?customer=cus_globex");
    const body = (await res.json()) as { invoices: InvoiceView[] };
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]?.customer).toBe("cus_globex");
  });
});

describe("GET /billing/invoices/:id", () => {
  it("returns one invoice, or 404 when the id is unknown", async () => {
    const found = await app.request("/billing/invoices/in_1002");
    expect(found.status).toBe(200);

    const invoice = (await found.json()) as InvoiceView;
    expect(invoice.status).toBe("open");
    expect(invoice.issuedOn).toBe("2026-09-01");

    const missing = await app.request("/billing/invoices/in_9999");
    expect(missing.status).toBe(404);
  });
});
