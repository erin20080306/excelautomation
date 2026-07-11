export type DataRow = Record<string, unknown>;
export type DataSet = { name: string; rows: DataRow[] };

function keyOf(row: DataRow, keys: string[]): string {
  return JSON.stringify(keys.map((key) => row[key] ?? null));
}

export function append(dataSets: DataSet[]): DataRow[] {
  return dataSets.flatMap((dataSet) => dataSet.rows.map((row) => ({ ...row, _source: row._source ?? dataSet.name })));
}

export function join(left: DataRow[], right: DataRow[], keys: string[], type: 'left' | 'right' | 'inner' | 'full' = 'left'): DataRow[] {
  if (!keys.length) throw new Error('Join 至少需要一個 KEY');
  const rightMap = new Map<string, DataRow[]>();
  for (const row of right) rightMap.set(keyOf(row, keys), [...(rightMap.get(keyOf(row, keys)) ?? []), row]);
  const matchedRight = new Set<DataRow>();
  const output: DataRow[] = [];
  for (const leftRow of left) {
    const matches = rightMap.get(keyOf(leftRow, keys)) ?? [];
    if (matches.length) {
      for (const rightRow of matches) { output.push({ ...rightRow, ...leftRow }); matchedRight.add(rightRow); }
    } else if (type === 'left' || type === 'full') output.push({ ...leftRow });
  }
  if (type === 'right' || type === 'full') {
    for (const rightRow of right) if (!matchedRight.has(rightRow)) output.push({ ...rightRow });
  }
  return output;
}

export function lookup(rows: DataRow[], master: DataRow[], keys: string[], fields: string[]): DataRow[] {
  if (!keys.length) throw new Error('Lookup 至少需要一個 KEY');
  const index = new Map(master.map((row) => [keyOf(row, keys), row]));
  return rows.map((row) => {
    const match = index.get(keyOf(row, keys));
    if (!match) return { ...row };
    return { ...row, ...Object.fromEntries(fields.filter((field) => row[field] == null).map((field) => [field, match[field]])) };
  });
}

export type Aggregate = { field: string; operation: 'sum' | 'average' | 'max' | 'min' | 'count' | 'distinctCount'; as?: string };

export function group(rows: DataRow[], keys: string[], aggregates: Aggregate[]): DataRow[] {
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) groups.set(keyOf(row, keys), [...(groups.get(keyOf(row, keys)) ?? []), row]);
  return [...groups.values()].map((members) => {
    const result: DataRow = Object.fromEntries(keys.map((key) => [key, members[0]?.[key]]));
    for (const aggregate of aggregates) {
      const values = members.map((row) => row[aggregate.field]).filter((value) => value != null);
      const numbers = values.map(Number).filter(Number.isFinite);
      const outputName = aggregate.as ?? `${aggregate.field}_${aggregate.operation}`;
      if (aggregate.operation === 'sum') result[outputName] = numbers.reduce((sum, value) => sum + value, 0);
      if (aggregate.operation === 'average') result[outputName] = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;
      if (aggregate.operation === 'max') result[outputName] = numbers.length ? Math.max(...numbers) : null;
      if (aggregate.operation === 'min') result[outputName] = numbers.length ? Math.min(...numbers) : null;
      if (aggregate.operation === 'count') result[outputName] = values.length;
      if (aggregate.operation === 'distinctCount') result[outputName] = new Set(values.map(String)).size;
    }
    return result;
  });
}

export function split(rows: DataRow[], field: string): Record<string, DataRow[]> {
  return rows.reduce<Record<string, DataRow[]>>((groups, row) => {
    const key = String(row[field] ?? '未分類').slice(0, 100);
    (groups[key] ??= []).push(row);
    return groups;
  }, {});
}

export type TransformRule =
  | { type: 'rename'; from: string; to: string }
  | { type: 'remove'; field: string }
  | { type: 'default'; field: string; value: unknown }
  | { type: 'concat'; fields: string[]; to: string; separator?: string }
  | { type: 'datePart'; field: string; to: string; part: 'year' | 'month' | 'day' }
  | { type: 'numeric'; field: string; multiplier?: number };

export function transform(rows: DataRow[], rules: TransformRule[]): DataRow[] {
  return rows.map((source) => {
    const row = { ...source };
    for (const rule of rules) {
      if (rule.type === 'rename') { row[rule.to] = row[rule.from]; delete row[rule.from]; }
      if (rule.type === 'remove') delete row[rule.field];
      if (rule.type === 'default' && row[rule.field] == null) row[rule.field] = rule.value;
      if (rule.type === 'concat') row[rule.to] = rule.fields.map((field) => row[field] ?? '').join(rule.separator ?? '');
      if (rule.type === 'datePart') {
        const date = new Date(String(row[rule.field] ?? ''));
        row[rule.to] = Number.isNaN(date.valueOf()) ? null : rule.part === 'year' ? date.getUTCFullYear() : rule.part === 'month' ? date.getUTCMonth() + 1 : date.getUTCDate();
      }
      if (rule.type === 'numeric') {
        const value = Number(row[rule.field]);
        row[rule.field] = Number.isFinite(value) ? value * (rule.multiplier ?? 1) : null;
      }
    }
    return row;
  });
}

export function deduplicate(rows: DataRow[], keys: string[], strategy: 'first' | 'last' | 'nonEmpty' | 'sum' = 'first'): DataRow[] {
  if (!keys.length) return [...rows];
  const output = new Map<string, DataRow>();
  for (const row of rows) {
    const key = keyOf(row, keys);
    const current = output.get(key);
    if (!current) { output.set(key, { ...row }); continue; }
    if (strategy === 'last') output.set(key, { ...row });
    if (strategy === 'nonEmpty') output.set(key, { ...current, ...Object.fromEntries(Object.entries(row).filter(([, value]) => value != null && value !== '')) });
    if (strategy === 'sum') {
      const merged = { ...current };
      for (const [field, value] of Object.entries(row)) {
        if (!keys.includes(field) && typeof value === 'number' && typeof merged[field] === 'number') merged[field] = (merged[field] as number) + value;
        else if (merged[field] == null) merged[field] = value;
      }
      output.set(key, merged);
    }
  }
  return [...output.values()];
}

export interface PipelineOperation { mode: 'append' | 'join' | 'lookup' | 'group' | 'split' | 'transform'; config: Record<string, any> }

export function runIntegration(dataSets: DataSet[], operations: PipelineOperation[]): DataSet[] {
  let current = dataSets.map((set) => ({ name: set.name, rows: set.rows.map((row) => ({ ...row })) }));
  for (const operation of operations) {
    if (operation.mode === 'append') current = [{ name: operation.config.name ?? '整合資料', rows: append(current) }];
    if (operation.mode === 'join') current = [{ name: operation.config.name ?? '關聯整合', rows: join(current[0]?.rows ?? [], current[1]?.rows ?? [], operation.config.keys ?? [], operation.config.type ?? 'left') }];
    if (operation.mode === 'lookup') current = [{ name: operation.config.name ?? current[0]?.name ?? '查找補值', rows: lookup(current[0]?.rows ?? [], current[1]?.rows ?? [], operation.config.keys ?? [], operation.config.fields ?? []) }];
    if (operation.mode === 'group') current = [{ name: operation.config.name ?? '分組統計', rows: group(append(current), operation.config.keys ?? [], operation.config.aggregates ?? []) }];
    if (operation.mode === 'transform') current = current.map((set) => ({ ...set, rows: transform(set.rows, operation.config.rules ?? []) }));
    if (operation.mode === 'split') current = Object.entries(split(append(current), operation.config.field)).map(([name, rows]) => ({ name, rows }));
    if (operation.config.deduplicate?.keys) current = current.map((set) => ({ ...set, rows: deduplicate(set.rows, operation.config.deduplicate.keys, operation.config.deduplicate.strategy) }));
  }
  return current;
}
