import type { Decision, DecisionField, Lever } from '../api/types'
/** 今の書きかけで使う欄 (条件のある欄は, 他の欄の値が合うときだけ) */
export function decisionFields(
  fields: DecisionField[],
  values: Record<string, string>,
): DecisionField[] {
  return fields.filter((field) => !field.when || values[field.when.key] === field.when.equals)
}

/** 保存した意思決定の値の, 欄に書く文字 (数の並びはカンマで区切る) */
export function decisionText(value: Decision[string]): string {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

/**
 * 数の並びの欄の書きかけの正規化 (区切りの前後の空白をそろえる. 数にするのは ML-Quest).
 * 空の要素 (末尾のカンマ, 続いたカンマ) は消さずに残し, ML-Quest の誤りで知らせる
 */
export function listText(text: string): string {
  return text
    .split(',')
    .map((item) => item.trim())
    .join(', ')
}

/** 意思決定の欄の書きかけから, 保存する形を作る (空の欄と使わない欄は除く) */
export function decisionDraft(
  kind: Decision['type'],
  fields: DecisionField[],
  values: Record<string, string>,
): Record<string, string> {
  const draft: Record<string, string> = { type: kind }
  for (const field of decisionFields(fields, values)) {
    const value = values[field.key]?.trim()
    if (value) draft[field.key] = field.list ? listText(value) : value
  }
  return draft
}

/**
 * 書きかけと保存した意思決定が同じか (数は文字で比べる. 1,500 と 1500 は違うと見る. 数の並びは
 * カンマで区切った文字で比べる)
 */
export function sameDecision(draft: Record<string, string>, saved: Decision | null): boolean {
  if (!saved) return false
  const text = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, decisionText(v)]))
  const keys = new Set([...Object.keys(draft), ...Object.keys(text)])
  return [...keys].every((key) => draft[key] === text[key])
}

/** 1 行に 1 つの書きかけを, 空の行を除いた並びに */
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 保存した要因と打てる手を, 形を確かめて行の並びに (崩れた行は除く) */
export function toLevers(value: unknown): Lever[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      cause: typeof row.cause === 'string' ? row.cause : '',
      lever: typeof row.lever === 'string' ? row.lever : '',
      ml: row.ml === true,
    }))
}
