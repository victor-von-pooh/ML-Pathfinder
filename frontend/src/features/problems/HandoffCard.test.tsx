import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Handoff, Problem, Question } from '../../api/types'
import { HandoffCard } from './HandoffCard'

/** 選択肢の問い (受け渡しの名前を引くためだけ) */
function choice(id: string, value: unknown, choices: [string, string][]): Question {
  return {
    id,
    section: 5,
    kind: 'choice',
    title: id,
    help: '',
    required: true,
    choices: choices.map(([v, label]) => ({ value: v, label })),
    value,
    answered: value !== null,
    applies: true,
  }
}

/** 受け渡しの値を持つ問題の設定 */
function problemWith(handoff: Handoff, questions: Question[]): Problem {
  return {
    id: '0123456789ab',
    name: '試し',
    created_at: null,
    updated_at: null,
    uses_ml: true,
    questions,
    progress: { answered: 0, required: 0, sections: [] },
    findings: [],
    summary: [],
    handoff,
    handoff_error: null,
    ready: true,
    exportable: false,
    export_error: null,
    finished: false,
    file_version: 2,
    version: 'x',
  }
}

/** 列の予測でない受け持ちの受け渡し (予測するで点群, 正解は今の処理の出力) */
const POINT_CLOUD: Handoff = {
  part: {
    role: 'predict',
    unit: 'bundle',
    output: 'shape',
    target_kind: 'point_cloud',
    target_source: 'process',
    target_process: { name: '今の計算', settings: '既定の設定' },
    method: 'scratch',
  },
  data: {
    target: null,
    task: null,
    time_column: null,
    series_by: [],
    split: null,
    group_column: null,
    min_lag: null,
    known: [],
    drop: [],
    source: null,
  },
  model: { task: null, outputs: null, role: 'predict', target_kind: 'point_cloud' },
  training: {
    metric: 'chamfer',
    monitor: 'valid/chamfer',
    mode: 'min',
    role: 'predict',
    target_kind: 'point_cloud',
  },
  inference: { decision: null, conclusion: {}, horizon: null },
}

describe('HandoffCard', () => {
  it('列の予測でなければ, 受け持ちと正解の出どころの処理を出す', () => {
    const questions = [
      choice('ml.parts.0.role', 'predict', [['predict', '予測する (当てる)']]),
      choice('ml.parts.0.target.kind', 'point_cloud', [['point_cloud', '点群']]),
      choice('ml.parts.0.target.source', 'process', [['process', '今の処理の出力 (計算)']]),
      choice('ml.parts.0.evaluation.metric', 'chamfer', []),
    ]
    render(<HandoffCard problem={problemWith(POINT_CLOUD, questions)} />)
    expect(screen.getByText('受け持ち: 予測する')).toBeInTheDocument()
    expect(screen.getByText('正解の種類: 点群')).toBeInTheDocument()
    expect(screen.getByText('正解の出どころ: 今の処理の出力')).toBeInTheDocument()
    expect(screen.getByText('今の計算')).toBeInTheDocument()
    expect(screen.getByText('処理の設定: 既定の設定')).toBeInTheDocument()
    expect(screen.getByText('valid/chamfer')).toBeInTheDocument()
    expect(screen.queryByText(/分割は/)).not.toBeInTheDocument()
  })

  it('列の予測は目的の列とタスクを出し, その他の指標は記録を頼む', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      part: { ...POINT_CLOUD.part, target_kind: 'column', target_process: null },
      data: { ...POINT_CLOUD.data, target: 'sales', task: 'regression', split: 'random' },
      model: { task: 'regression', outputs: 1, role: 'predict', target_kind: 'column' },
      training: { ...POINT_CLOUD.training, metric: 'wape', monitor: 'valid/wape' },
    }
    const questions = [
      choice('ml.parts.0.task', 'regression', [['regression', '回帰 (値)']]),
      choice('ml.parts.0.evaluation.metric', 'other', [['other', 'その他']]),
    ]
    render(<HandoffCard problem={problemWith(handoff, questions)} />)
    expect(screen.getByText('sales')).toBeInTheDocument()
    expect(screen.getByText(/回帰, 分割は/)).toBeInTheDocument()
    expect(screen.getByText(/その他の指標です/)).toBeInTheDocument()
    expect(screen.queryByText(/受け持ち:/)).not.toBeInTheDocument()
  })
})
