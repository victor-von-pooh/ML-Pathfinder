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
    requires: [],
    ready: true,
    exportable: false,
    export_error: null,
    open_errors: [],
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
  requires: [],
  policy: null,
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

  it('ファイルの組の受け持ちで渡す分割とグループを件数で出す', () => {
    const questions = [
      choice('ml.parts.0.role', 'predict', [['predict', '予測する (当てる)']]),
      choice('ml.parts.0.target.kind', 'point_cloud', [['point_cloud', '点群']]),
    ]
    const handoff: Handoff = {
      ...POINT_CLOUD,
      data: {
        ...POINT_CLOUD.data,
        split: 'group',
        groups: { a: 'site_1', b: 'site_1', c: 'site_2' },
      },
    }
    render(<HandoffCard problem={problemWith(handoff, questions)} />)
    expect(screen.getByText('group')).toBeInTheDocument()
    expect(screen.getByText(/グループ 2 種類, 3 件/)).toBeInTheDocument()
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

  it('方策の守りと, 人が決めることと実機は道具の外であることを出す', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      part: { ...POINT_CLOUD.part, role: 'effect', target_process: null },
      requires: ['rl', 'mujoco'],
      policy: {
        action_limits: '各関節の速さは毎秒 0.5 rad まで',
        stop: '腕の先が台の上 0 から 0.3 m を出たら',
        fallback: 'handover',
        fallback_action: null,
        safety_key: 'cost',
        approver: '設備の責任者',
      },
    }
    const questions = [
      choice('ml.parts.0.policy.fallback', 'handover', [
        ['handover', '元の制御に戻す (人か今の仕組み)'],
      ]),
    ]
    const problem = {
      ...problemWith(handoff, questions),
      requires: [
        {
          name: 'rl',
          label: '強化学習',
          description: null,
          install: null,
          note: null,
          source: 'ml_quest' as const,
        },
      ],
    }
    render(<HandoffCard problem={problem} />)
    expect(screen.getByText('行動の上限: 各関節の速さは毎秒 0.5 rad まで')).toBeInTheDocument()
    expect(screen.getByText('外れたときの動き: 元の制御に戻す')).toBeInTheDocument()
    expect(screen.getByText('安全の違反の信号: cost')).toBeInTheDocument()
    expect(screen.queryByText(/決めた行動:/)).not.toBeInTheDocument()
    expect(screen.getByText(/人 \(設備の責任者\) が決めます/)).toHaveTextContent(
      /実機で動かすのは道具の外/,
    )
    expect(screen.getByText('強化学習, mujoco')).toBeInTheDocument()
  })

  it('方策でなければ守りを出さない', () => {
    render(<HandoffCard problem={problemWith(POINT_CLOUD, [])} />)
    expect(screen.queryByText(/方策の守り/)).not.toBeInTheDocument()
    expect(screen.queryByText(/学習のプロジェクト/)).not.toBeInTheDocument()
  })

  it('書き出したプロジェクトの場所を出す (モデルの定義が無ければ出さない)', () => {
    const problem = {
      ...problemWith(POINT_CLOUD, []),
      project: { path: '/work/p', dataset: '/work/p/data/clouds', model_spec: null },
    }
    render(<HandoffCard problem={problem} />)
    expect(screen.getByText('/work/p')).toBeInTheDocument()
    expect(screen.getByText('/work/p/data/clouds')).toBeInTheDocument()
    expect(screen.queryByText(/モデルの定義の置き場/)).not.toBeInTheDocument()
  })
})
