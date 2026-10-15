// Squarified treemap layout (Bruls, Huizing & van Wijk). Pure function.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile<T> extends Rect {
  item: T;
}

function worst(row: number[], side: number): number {
  const sum = row.reduce((s, v) => s + v, 0);
  if (!sum || !side) return Infinity;
  const max = Math.max(...row);
  const min = Math.min(...row);
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

export function squarify<T>(items: T[], value: (t: T) => number, rect: Rect): Tile<T>[] {
  const total = items.reduce((s, i) => s + Math.max(0, value(i)), 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const queue = items.filter((i) => value(i) > 0).map((item) => ({ item, area: value(item) * scale }));
  const out: Tile<T>[] = [];
  let free = { ...rect };

  while (queue.length) {
    const side = Math.min(free.w, free.h);
    const row: typeof queue = [];
    while (queue.length) {
      const next = queue[0];
      const current = row.map((r) => r.area);
      if (row.length && worst([...current, next.area], side) > worst(current, side)) break;
      row.push(queue.shift()!);
    }
    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (free.w >= free.h) {
      const colW = rowArea / free.h;
      let y = free.y;
      for (const r of row) {
        const h = r.area / colW;
        out.push({ item: r.item, x: free.x, y, w: colW, h });
        y += h;
      }
      free = { x: free.x + colW, y: free.y, w: free.w - colW, h: free.h };
    } else {
      const rowH = rowArea / free.w;
      let x = free.x;
      for (const r of row) {
        const w = r.area / rowH;
        out.push({ item: r.item, x, y: free.y, w, h: rowH });
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: free.h - rowH };
    }
  }
  return out;
}
