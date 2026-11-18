import { decisionDraft, decisionFields, sameDecision, splitLines, toLevers } from './draft'

describe('decisionDraft', () => {
  it('型の項目だけを, 空の欄を除いて残す', () => {
    expect(
      decisionDraft('quantity', { under_cost: ' 200 ', over_cost: '', miss_cost: '9' }),
    ).toEqual({ type: 'quantity', under_cost: '200' })
    expect(decisionDraft('none', { under_cost: '1' })).toEqual({ type: 'none' })
  })
})

describe('確率の差の向き', () => {
  it('効果を確率の差で渡すときだけ向きを残す', () => {
    const values = { value: '1000', cost: '50', effect: '-0.1', effect_goal: 'reduce' }
    expect(decisionDraft('select', values)).not.toHaveProperty('effect_goal')
    expect(decisionFields('select', values).map((f) => f.key)).not.toContain('effect_goal')
    const uplift = { ...values, effect_kind: 'uplift' }
    expect(decisionDraft('select', uplift)).toEqual({
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
