import type { Decision, Finding } from '../api/types'

/** 意思決定の型ごとの項目と説明 (ML-Inference の形) */
export const DECISION_FIELDS: Record<Decision['type'], { key: string; label: string }[]> = {
  quantity: [
    { key: 'under_cost', label: '1 単位足りないときの損 (欠品の粗利など)' },
    { key: 'over_cost', label: '1 単位余ったときの損 (捨てるなら原価など)' },
    { key: 'stock', label: '今ある量 (任意. 行ごとに違えば列の名前)' },
    { key: 'step', label: '量の刻み (任意)' },
  ],
  select: [
    { key: 'value', label: '当たり 1 件の価値 (行ごとに違えば列の名前)' },
    { key: 'cost', label: '行動 1 件の費用' },
    { key: 'effect', label: '行動で防げる割合 (0 から 1. 仮定)' },
    { key: 'budget', label: '件数の上限 (任意)' },
    { key: 'budget_cost', label: '費用の上限 (任意)' },
  ],
  triage: [
    { key: 'miss_cost', label: '当たりを見逃す損' },
    { key: 'false_alarm_cost', label: '外れを回す損 (空振り)' },
    { key: 'capacity', label: '回せる件数の上限 (任意)' },
  ],
  none: [],
}

/** 意思決定の型の名前 */
export const DECISION_NAMES: Record<Decision['type'], string> = {
  quantity: '量を決める (仕入れ, 補充, 人員)',
  select: '対象を選ぶ (引き止め, 営業先)',
  triage: '振り分ける (人が確かめる, 再検査)',
  none: '意思決定しない (人が予測を見て決める)',
}

/** 確かめの重さの名前 */
export const LEVEL_NAMES: Record<Finding['level'], string> = {
  error: '直す',
  warning: '見直す',
  info: '知らせ',
}
