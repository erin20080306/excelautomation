import { describe, expect, it } from 'vitest';
import { append, deduplicate, group, join, lookup, split, transform } from './integration.js';

describe('integration engine', () => {
  it('appends data sets with source lineage', () => {
    expect(append([{ name: 'A', rows: [{ id: 1 }] }, { name: 'B', rows: [{ id: 2 }] }])).toEqual([{ id: 1, _source: 'A' }, { id: 2, _source: 'B' }]);
  });
  it('supports left, inner, right and full join', () => {
    const left = [{ id: 1, a: 'A' }, { id: 2, a: 'B' }];
    const right = [{ id: 1, b: 'C' }, { id: 3, b: 'D' }];
    expect(join(left, right, ['id'], 'left')).toHaveLength(2);
    expect(join(left, right, ['id'], 'inner')).toEqual([{ id: 1, b: 'C', a: 'A' }]);
    expect(join(left, right, ['id'], 'right')).toHaveLength(2);
    expect(join(left, right, ['id'], 'full')).toHaveLength(3);
  });
  it('looks up missing fields without overwriting source values', () => {
    expect(lookup([{ sku: 'A', name: '來源名稱' }], [{ sku: 'A', name: '主檔', unit: 'PCS' }], ['sku'], ['name', 'unit'])).toEqual([{ sku: 'A', name: '來源名稱', unit: 'PCS' }]);
  });
  it('groups using every supported aggregation', () => {
    const result = group([{ k: 'A', n: 2 }, { k: 'A', n: 4 }, { k: 'A', n: 4 }], ['k'], [
      { field: 'n', operation: 'sum' }, { field: 'n', operation: 'average' }, { field: 'n', operation: 'max' },
      { field: 'n', operation: 'min' }, { field: 'n', operation: 'count' }, { field: 'n', operation: 'distinctCount' }
    ]);
    expect(result[0]).toMatchObject({ n_sum: 10, n_average: 10 / 3, n_max: 4, n_min: 2, n_count: 3, n_distinctCount: 2 });
  });
  it('splits, transforms and deduplicates rows', () => {
    expect(Object.keys(split([{ team: '北' }, { team: '南' }], 'team'))).toEqual(['北', '南']);
    expect(transform([{ a: 'x', b: 'y', amount: '10' }], [{ type: 'concat', fields: ['a', 'b'], to: 'c', separator: '-' }, { type: 'numeric', field: 'amount', multiplier: 2 }])).toEqual([{ a: 'x', b: 'y', c: 'x-y', amount: 20 }]);
    expect(deduplicate([{ id: 1, n: 2 }, { id: 1, n: 3 }], ['id'], 'sum')).toEqual([{ id: 1, n: 5 }]);
  });
});
