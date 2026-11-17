import type { Decision } from '../api/types'
import { DECISION_FIELDS } from './labels'

/** 意思決定の欄の書きかけから, 保存する形を作る (空の欄は除く) */
export function decisionDraft(
  kind: Decision['type'],
  values: Record<string, string>,
): Record<string, string> {
  const draft: Record<string, string> = { type: kind }
  for (const field of DECISION_FIELDS[kind]) {
    const value = values[field.key]?.trim()
    if (value) draft[field.key] = value
  }
  return draft
}

/** 書きかけと保存した意思決定が同じか (数は文字で比べる. 1,500 と 1500 は違うと見る) */
export function sameDecision(draft: Record<string, string>, saved: Decision | null): boolean {
  if (!saved) return false
  const text = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, String(v)]))
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
