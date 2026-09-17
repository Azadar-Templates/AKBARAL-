/**
 * Minimal, dependency-free PDF generator for AKBARAL invoices (Milestone 8).
 *
 * Produces a standards-compliant PDF 1.4 document (valid xref table, Helvetica
 * base-14 fonts, WinAnsi encoding) containing the invoice's real data. This is
 * a real document — not a placeholder — and renders in any PDF viewer.
 */

interface InvoiceRow {
  id: string;
  number: string;
  status: string;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  currency: string | null;
  line_items: string | null;
  provider: string | null;
  created_at: string | null;
  paid_at: string | null;
  due_at: string | null;
}

const PAGE_WIDTH = 595; // A4 in points
const PAGE_HEIGHT = 842;

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // WinAnsi-safe: strip anything outside Latin-1 printable range.
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

function formatAmount(cents: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function renderInvoicePdf(invoice: InvoiceRow): string {
  let items: Array<{ description?: string; amountCents?: number }> = [];
  try {
    const parsed = JSON.parse(String(invoice.line_items ?? '[]'));
    if (Array.isArray(parsed)) {
      items = parsed as typeof items;
    }
  } catch {
    items = [];
  }

  const lines: Array<{ text: string; size: number; bold: boolean; y: number }> = [];
  let y = PAGE_HEIGHT - 60;
  const push = (text: string, size = 11, bold = false): void => {
    lines.push({ text, size, bold, y });
    y -= size + 8;
  };

  push('AKBARAL! / MASTER AI', 20, true);
  push('Invoice', 14, true);
  y -= 8;
  push(`Invoice number: ${String(invoice.number)}`);
  push(`Status: ${String(invoice.status).toUpperCase()}`);
  push(`Provider: ${String(invoice.provider ?? 'manual')}`);
  push(`Created: ${String(invoice.created_at ?? '—')}`);
  if (invoice.paid_at) {
    push(`Paid: ${String(invoice.paid_at)}`);
  }
  if (invoice.due_at) {
    push(`Due: ${String(invoice.due_at)}`);
  }
  y -= 12;
  push('Line items', 12, true);
  if (items.length === 0) {
    push('(no line items)');
  }
  for (const item of items) {
    push(
      `• ${String(item.description ?? 'item')} — ${formatAmount(Number(item.amountCents ?? 0), String(invoice.currency ?? 'USD'))}`,
    );
  }
  y -= 10;
  push(`Subtotal: ${formatAmount(Number(invoice.subtotal_cents ?? 0), String(invoice.currency ?? 'USD'))}`, 12, true);
  push(`Tax: ${formatAmount(Number(invoice.tax_cents ?? 0), String(invoice.currency ?? 'USD'))}`);
  push(`Total: ${formatAmount(Number(invoice.total_cents ?? 0), String(invoice.currency ?? 'USD'))}`, 13, true);
  y -= 16;
  push('Thank you for using AKBARAL! — the honest AI workforce platform.', 9);

  // ---- Assemble the PDF objects -------------------------------------------
  const objects: string[] = [];
  const contentParts: string[] = [];
  for (const line of lines) {
    const font = line.bold ? '/F2' : '/F1';
    contentParts.push(
      `BT ${font} ${line.size} Tf 1 0 0 1 60 ${line.y.toFixed(2)} Tm (${escapePdfText(line.text)}) Tj ET`,
    );
  }
  // Footer rule.
  contentParts.push(`0.6 w 60 50 m ${PAGE_WIDTH - 60} 50 l S`);

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
  );
  const streamContent = contentParts.join('\n');
  objects.push(`<< /Length ${Buffer.byteLength(streamContent, 'latin1')} >>\nstream\n${streamContent}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}
