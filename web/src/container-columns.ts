export const CONTAINER_COLUMNS = [
  { id: "name", label: "Nome", min: 96, default: 320 },
  { id: "image", label: "Imagem", min: 96, default: 280 },
  { id: "status", label: "Status", min: 88, default: 130 },
  { id: "actions", label: "Ações", min: 120, default: 150 },
  { id: "ports", label: "Portas", min: 72, default: 120 },
  { id: "tools", label: "", min: 64, default: 72 },
  { id: "usage", label: "Uso", min: 120, default: 180 },
] as const;

export type ColumnWidths = number[];

export function defaultColumnWidths(): ColumnWidths {
  return CONTAINER_COLUMNS.map((c) => c.default);
}

export function normalizeColumnWidths(raw?: number[] | null): ColumnWidths {
  const d = defaultColumnWidths();
  if (!raw || raw.length !== d.length) return d;
  return raw.map((n, i) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return d[i];
    return Math.max(CONTAINER_COLUMNS[i].min, Math.round(v));
  });
}

export function containerTableInlineStyle(widths: ColumnWidths): string {
  const vars = CONTAINER_COLUMNS.map((col, i) => `--ct-col-${col.id}:${widths[i]}px`).join(";");
  const gap = (CONTAINER_COLUMNS.length - 1) * 10;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap;
  return `${vars};width:max(100%,${total}px)`;
}
