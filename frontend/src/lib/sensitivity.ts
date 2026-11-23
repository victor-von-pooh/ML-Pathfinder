import type { Decision, Sensitivity, SensitivityField } from '../api/types'

/**
 * 決め手の順の項目 (振れ幅の大きい順. データの上の損を求めた場合は今のやり方の損の振れ幅,
 * 他は決め方の値の振れ幅で比べる. 同じなら件数の上限の振れ幅)
 */
export function bySwing(result: Sensitivity): SensitivityField[] {
  const withLoss = result.fields.some((field) => field.swing.loss !== null)
  const limitSpread = (field: SensitivityField) => {
    const limits = field.points
      .map((point) => point.limit)
      .filter((value): value is number => typeof value === 'number')
    return limits.length ? Math.max(...limits) - Math.min(...limits) : -1
  }
  const key = (field: SensitivityField) => (withLoss ? field.swing.loss : field.swing.rule) ?? -1
  return [...result.fields].sort((a, b) => key(b) - key(a) || limitSpread(b) - limitSpread(a))
}

/** 幅を渡せる項目 (列で書いた項目は行ごとの値なので除く. 選ぶ型の上限は書いた方だけ) */
export function rangeFields(decision: Decision, fields: string[]): string[] {
  return fields.filter((field) => {
    if (typeof decision[field] === 'string') return false
    if (field === 'budget' && decision.budget_cost !== undefined) return false
    if (field === 'budget_cost' && decision.budget !== undefined) return false
    return true
  })
}

/** 書いた幅を数にする (空の項目は除く. 片方だけか数でなければ誤りの文) */
export function parseRanges(
  ranges: Record<string, { low: string; high: string }>,
  labels: Record<string, string>,
): Record<string, [number, number]> | string {
  const parsed: Record<string, [number, number]> = {}
  for (const [field, { low, high }] of Object.entries(ranges)) {
    const texts = [low.trim(), high.trim()]
    if (!texts[0] && !texts[1]) continue
    const label = labels[field] ?? field
    if (!texts[0] || !texts[1]) return `${label}の幅は, 下と上の両方を書いてください`
    const numbers = texts.map((text) => Number(text.replace(/,/g, '')))
    if (numbers.some((value) => !Number.isFinite(value))) return `${label}の幅は数で書いてください`
    const [lower = 0, upper = 0] = numbers
    parsed[field] = [lower, upper]
  }
  if (Object.keys(parsed).length === 0) return '幅を 1 つ以上の項目に書いてください'
  return parsed
}
