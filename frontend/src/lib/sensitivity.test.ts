import { describe, expect, it } from 'vitest'

import type { Sensitivity, SensitivityField } from '../api/types'
import { bySwing, parseRanges, rangeFields } from './sensitivity'

/** 項目の結論 (振れ幅と件数の上限だけを変える) */
function field(name: string, rule: number | null, loss: number | null, limits: number[] = []) {
  const points = (limits.length ? limits : [0]).map((limit, index) => ({
    value: index,
    rule: 0.5,
    ...(limits.length ? { limit } : {}),
  }))
  return { field: name, label: name, points, swing: { rule, loss }, sentence: '' }
}

function result(fields: SensitivityField[]): Sensitivity {
  return { type: 'select', rule: '下限', base: { rule: 0.5 }, fields, data: null, notes: [] }
}

describe('sensitivity', () => {
  it('損を求めれば損の振れ幅, 求めなければ決め方の値の振れ幅, 同じなら件数の上限の順', () => {
    const rule = bySwing(
      result([field('a', 0.1, null), field('b', 0.0, null, [100, 500]), field('c', 0.3, null)]),
    )
    expect(rule.map((f) => f.field)).toEqual(['c', 'a', 'b'])
    const tie = bySwing(result([field('a', 0, null, [1, 2]), field('b', 0, null, [1, 9])]))
    expect(tie.map((f) => f.field)).toEqual(['b', 'a'])
    const loss = bySwing(result([field('a', 0.9, 10), field('b', 0.1, 500)]))
    expect(loss.map((f) => f.field)).toEqual(['b', 'a'])
  })

  it('列で書いた項目と, 書いていない方の選ぶ型の上限を除く', () => {
    const names = ['value', 'cost', 'effect', 'budget', 'budget_cost']
    expect(rangeFields({ type: 'select', value: 'ltv', cost: 1500, budget: 300 }, names)).toEqual([
      'cost',
      'effect',
      'budget',
    ])
    expect(rangeFields({ type: 'select', budget_cost: 9000 }, names)).toEqual([
      'value',
      'cost',
      'effect',
      'budget_cost',
    ])
  })

  it('幅を数にし, 空の項目を除き, 片方だけか数でなければ誤りの文', () => {
    const labels = { cost: '行動の費用' }
    expect(
      parseRanges({ cost: { low: '1,000', high: ' 6000 ' }, value: { low: '', high: '' } }, labels),
    ).toEqual({ cost: [1000, 6000] })
    expect(parseRanges({ cost: { low: '1', high: '' } }, labels)).toBe(
      '行動の費用の幅は, 下と上の両方を書いてください',
    )
    expect(parseRanges({ cost: { low: 'a', high: '2' } }, labels)).toBe(
      '行動の費用の幅は数で書いてください',
    )
    expect(parseRanges({}, labels)).toBe('幅を 1 つ以上の項目に書いてください')
  })
})
