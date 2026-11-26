import type { DecisionField } from '../api/types'
import {
  decisionDraft,
  decisionFields,
  decisionText,
  listText,
  sameDecision,
  splitLines,
  toLevers,
} from './draft'

// ML-Quest が返す欄の形 (テスト用に一部)
const QUANTITY: DecisionField[] = [
  { key: 'under_cost', label: '足りない損', required: true },
  { key: 'over_cost', label: '余る損', required: true },
]
const SELECT: DecisionField[] = [
  { key: 'value', label: '価値', required: true },
  { key: 'cost', label: '費用', required: true },
  { key: 'effect_kind', label: '渡し方', required: false },
  { key: 'effect', label: '効果', required: true },
  {
    key: 'effect_goal',
    label: '向き',
    required: true,
    when: { key: 'effect_kind', equals: 'uplift' },
  },
]

describe('decisionDraft', () => {
  it('型の項目だけを, 空の欄を除いて残す', () => {
    expect(
      decisionDraft('quantity', QUANTITY, { under_cost: ' 200 ', over_cost: '', miss_cost: '9' }),
    ).toEqual({ type: 'quantity', under_cost: '200' })
    expect(decisionDraft('none', [], { under_cost: '1' })).toEqual({ type: 'none' })
  })
})

describe('条件のある欄', () => {
  it('他の欄の値が合うときだけ残す (確率の差の向き)', () => {
    const values = { value: '1000', cost: '50', effect: '-0.1', effect_goal: 'reduce' }
    expect(decisionDraft('select', SELECT, values)).not.toHaveProperty('effect_goal')
    expect(decisionFields(SELECT, values).map((f) => f.key)).not.toContain('effect_goal')
    const uplift = { ...values, effect_kind: 'uplift' }
    expect(decisionDraft('select', SELECT, uplift)).toEqual({
      type: 'select',
      value: '1000',
      cost: '50',
      effect_kind: 'uplift',
      effect: '-0.1',
      effect_goal: 'reduce',
    })
  })
})

describe('sameDecision', () => {
  it('保存した値と文字で比べる', () => {
    const saved = { type: 'quantity' as const, under_cost: 200, over_cost: 150 }
    expect(sameDecision({ type: 'quantity', under_cost: '200', over_cost: '150' }, saved)).toBe(
      true,
    )
    expect(sameDecision({ type: 'quantity', under_cost: '200' }, saved)).toBe(false)
    expect(sameDecision({ type: 'quantity' }, null)).toBe(false)
  })
})

describe('数の並びの欄', () => {
  const PRICE: DecisionField[] = [
    { key: 'candidates', label: '値段の候補', required: true, list: true },
    { key: 'max_change', label: '値段を変える幅の上限', required: true },
  ]
  it('カンマの前後の空白をそろえて文で送り, 保存した並びと同じと見る', () => {
    const draft = decisionDraft('price', PRICE, {
      candidates: ' -0.1 ,0,  0.1 ',
      max_change: '0.1',
    })
    expect(draft).toEqual({ type: 'price', candidates: '-0.1, 0, 0.1', max_change: '0.1' })
    const saved = { type: 'price' as const, candidates: [-0.1, 0, 0.1], max_change: 0.1 }
    expect(sameDecision(draft, saved)).toBe(true)
    expect(sameDecision({ ...draft, candidates: '-0.1, 0' }, saved)).toBe(false)
    expect(decisionText(saved.candidates)).toBe('-0.1, 0, 0.1')
  })
})

describe('listText', () => {
  it('区切りの前後の空白をそろえ, 空の要素は消さずに残す (誤りは ML-Quest が知らせる)', () => {
    expect(listText('0.1,0.5 ,  0.9')).toBe('0.1, 0.5, 0.9')
    expect(listText('0.1, 0.9,')).toBe('0.1, 0.9, ')
    expect(listText('0.1,,0.9')).toBe('0.1, , 0.9')
  })
})

describe('splitLines', () => {
  it('空の行と前後の空白を除く', () => {
    expect(splitLines(' a \n\nb\n ')).toEqual(['a', 'b'])
  })
})

describe('toLevers', () => {
  it('崩れた行と値を除いて行にする', () => {
    expect(toLevers([{ cause: 'a', lever: 1, ml: 'yes' }, 'x', null])).toEqual([
      { cause: 'a', lever: '', ml: false },
    ])
    expect(toLevers('x')).toEqual([])
  })
})
