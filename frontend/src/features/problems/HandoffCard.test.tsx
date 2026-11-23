import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Choice, Handoff, Problem, Question } from '../../api/types'
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
    multiline: false,
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
  model: {
    task: null,
    outputs: null,
    role: 'predict',
    target_kind: 'point_cloud',
    example: 'point_cloud_predictor',
  },
  training: {
    metric: 'chamfer',
    monitor: 'valid/chamfer',
    mode: 'min',
    role: 'predict',
    target_kind: 'point_cloud',
  },
  inference: { decision: null, conclusion: {}, horizon: null, ready: null },
  requires: [],
  policy: null,
}

/**
 * 受け渡しの分割の名前 (/api/info の splits の形). ML-Quest の SPLITS の手の写し.
 * /api/info の値が ML-Quest の SPLITS と同じかは backend の test_api.py が突き合わせる.
 * この写しは突き合わせないので, ML-Quest の SPLITS が変わったら手で合わせる
 */
const SPLITS: Choice[] = [
  { value: 'time', label: '時刻の順 (後ろの期間を検証用とテスト用に)', grouped: false },
  { value: 'group', label: '相手ごと (同じ相手は同じ分割に)', grouped: true },
  { value: 'random', label: '無作為', grouped: false },
  { value: 'stratified', label: '層別 (クラスの割合をそろえて無作為に)', grouped: false },
  {
    value: 'group_time',
    label: '相手ごとと時刻の順 (後から現れた相手を検証用とテスト用に)',
    grouped: true,
  },
  {
    value: 'stratified_group',
    label: '相手ごとの層別 (同じ相手は同じ分割に, クラスの割合をそろえて. 分類だけ)',
    grouped: true,
  },
  { value: 'none', label: '分けない (全て学習用)', grouped: false },
]

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
    expect(screen.getByText(/監視の向き/)).toHaveTextContent('監視の向き min (小さいほど良い)')
    expect(screen.queryByText(/分割は/)).not.toBeInTheDocument()
  })

  it('表の生成は, 雛形 diffusion_denoiser と, 列ごとの分布の近さの監視と向きを出す', () => {
    const table: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        role: 'generate',
        unit: 'row',
        output: 'table',
        target_kind: 'table',
        target_source: 'self',
        target_process: null,
      },
      data: { ...POINT_CLOUD.data, split: 'random' },
      model: {
        ...POINT_CLOUD.model,
        role: 'generate',
        target_kind: 'table',
        example: 'diffusion_denoiser',
      },
      training: {
        metric: 'column_distance',
        monitor: 'valid/column_distance',
        mode: 'min',
        role: 'generate',
        target_kind: 'table',
      },
    }
    const questions = [
      choice('ml.parts.0.role', 'generate', [['generate', '作る (生成)']]),
      choice('ml.parts.0.target.kind', 'table', [['table', '表']]),
      choice('ml.parts.0.evaluation.metric', 'column_distance', [
        ['loss', '検証用の分割での損失 (小さいほど良い)'],
        ['column_distance', '作った表と本物の表の列ごとの分布の近さ (小さいほど良い)'],
      ]),
    ]
    render(<HandoffCard problem={problemWith(table, questions)} splits={SPLITS} />)
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent(
      'モデルの作成の雛形: diffusion_denoiser (モデルの作成の画面で開ける例)',
    )
    expect(screen.getByText(/監視する指標/)).toHaveTextContent(
      '監視する指標 valid/column_distance (作った表と本物の表の列ごとの分布の近さ)',
    )
    expect(screen.getByText(/監視の向き/)).toHaveTextContent('監視の向き min (小さいほど良い)')
    expect(screen.getByText(/画像と表の生成は分割を渡します/)).toBeInTheDocument()
  })

  it('指標の説明は今の答えに合う選択肢から引き, 合わなければ添えない', () => {
    const loss: Handoff = {
      ...POINT_CLOUD,
      training: { ...POINT_CLOUD.training, metric: 'loss', monitor: 'valid/loss' },
    }
    // 選択肢は ML-Quest が今の受け持ちに合うものに絞って返す (点群なら検証用の分割での損失)
    const metric = choice('ml.parts.0.evaluation.metric', 'loss', [
      ['loss', '検証用の分割での損失 (小さいほど良い)'],
    ])
    const { rerender } = render(<HandoffCard problem={problemWith(loss, [metric])} />)
    expect(screen.getByText(/監視する指標/)).toHaveTextContent(
      '監視する指標 valid/loss (検証用の分割での損失)',
    )
    expect(screen.queryByText(/交差エントロピー|報酬/)).not.toBeInTheDocument()

    // 問いが要らないときと, 答えが渡す指標と違うときは添えない (違う説明を出さない)
    rerender(<HandoffCard problem={problemWith(loss, [{ ...metric, applies: false }])} />)
    expect(screen.getByText(/監視する指標/)).toHaveTextContent(/^監視する指標 valid\/loss$/)
    rerender(
      <HandoffCard
        problem={problemWith(loss, [
          choice('ml.parts.0.evaluation.metric', 'chamfer', [
            ['chamfer', '点群の近さ (Chamfer 距離. 小さいほど良い)'],
            ['loss', '検証用の分割での損失 (小さいほど良い)'],
          ]),
        ])}
      />,
    )
    expect(screen.getByText(/監視する指標/)).toHaveTextContent(/^監視する指標 valid\/loss$/)
  })

  it('モデルの作成の雛形の名前を見出しと出し, 無ければ理由を言葉で出す', () => {
    const { rerender } = render(<HandoffCard problem={problemWith(POINT_CLOUD, [])} />)
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent(
      'モデルの作成の雛形: point_cloud_predictor (モデルの作成の画面で開ける例)',
    )

    // 一から学習するが合う例が無い受け持ち
    const none: Handoff = { ...POINT_CLOUD, model: { ...POINT_CLOUD.model, example: null } }
    rerender(<HandoffCard problem={problemWith(none, [])} />)
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent(
      'モデルの作成の雛形: 受け持ちに合う雛形はありません (モデルの作成の画面で定義を選ぶ)',
    )
    expect(screen.queryByText('point_cloud_predictor')).not.toBeInTheDocument()

    // 一から学習しない (既製の重みから学習する) 受け持ち
    const tuned: Handoff = { ...none, part: { ...none.part, method: 'finetune' } }
    rerender(<HandoffCard problem={problemWith(tuned, [])} />)
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent(
      'モデルの作成の雛形: 一から学習しないので, 合う雛形はありません',
    )
    expect(screen.getByText(/モデルの作成の雛形/)).not.toHaveTextContent('定義を選ぶ')
  })

  it('監視の向きが無ければ, 向きの行を出さない', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      training: { ...POINT_CLOUD.training, mode: null },
    }
    render(<HandoffCard problem={problemWith(handoff, [])} />)
    expect(screen.getByText('valid/chamfer')).toBeInTheDocument()
    expect(screen.queryByText(/監視の向き/)).not.toBeInTheDocument()
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
    // 分割の名前は /api/info の splits の説明の括弧の前まで (読む前は値のまま)
    const splits = [{ value: 'group', label: '相手ごと (同じ相手は同じ分割に)' }]
    const { rerender } = render(<HandoffCard problem={problemWith(handoff, questions)} />)
    expect(screen.getByText(/分割はgroup/)).toBeInTheDocument()
    rerender(<HandoffCard problem={problemWith(handoff, questions)} splits={splits} />)
    expect(screen.getByText(/分割は相手ごと/)).toBeInTheDocument()
    expect(screen.getByText(/グループ 2 種類, 3 件/)).toBeInTheDocument()
  })

  it('列の予測は目的の列とタスクを出し, その他の指標は記録を頼む', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      part: { ...POINT_CLOUD.part, target_kind: 'column', target_process: null },
      data: { ...POINT_CLOUD.data, target: 'sales', task: 'regression', split: 'random' },
      model: {
        task: 'regression',
        outputs: 1,
        role: 'predict',
        target_kind: 'column',
        example: null,
      },
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
    // 列の予測は合う雛形が無い (一から学習)
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent(
      '受け持ちに合う雛形はありません',
    )
  })

  it('既製のモデルは学習の欄を出さず, 推論に出どころとモデルと重みと hash を出す', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        target_kind: 'column',
        target_process: null,
        method: 'pretrained',
      },
      training: { metric: null, monitor: null, mode: null, role: 'predict', target_kind: 'column' },
      inference: {
        decision: null,
        conclusion: {},
        horizon: null,
        ready: {
          library: 'torchvision',
          model: 'resnet18',
          weights: 'IMAGENET1K_V1',
          sha256: 'ab12cd',
        },
      },
    }
    const questions = [
      choice('ml.parts.0.ready.library', 'torchvision', [
        ['torchvision', 'torchvision (画像の分類の学習済みの重み)'],
      ]),
    ]
    render(<HandoffCard problem={problemWith(handoff, questions)} />)
    expect(screen.queryByText(/学習 \(ML-Found/)).not.toBeInTheDocument()
    expect(screen.queryByText(/監視する指標/)).not.toBeInTheDocument()
    expect(screen.getByText(/学習しません/)).toBeInTheDocument()
    expect(screen.queryByText(/モデルの作成の雛形/)).not.toBeInTheDocument()
    expect(screen.getByText('torchvision')).toBeInTheDocument()
    expect(screen.getByText('resnet18')).toBeInTheDocument()
    expect(screen.getByText('IMAGENET1K_V1')).toBeInTheDocument()
    expect(screen.getByText('ab12cd')).toBeInTheDocument()
    expect(screen.queryByText(/重みの版を固定していません/)).not.toBeInTheDocument()
  })

  it('既製のモデルで hash が無ければ固定しないことを添える', () => {
    const handoff: Handoff = {
      ...POINT_CLOUD,
      training: { metric: null, monitor: null, mode: null, role: 'predict', target_kind: null },
      inference: {
        decision: null,
        conclusion: {},
        horizon: null,
        ready: {
          library: 'torchvision',
          model: 'resnet18',
          weights: 'IMAGENET1K_V1',
          sha256: null,
        },
      },
    }
    render(<HandoffCard problem={problemWith(handoff, [])} />)
    expect(screen.getByText('決めていません')).toBeInTheDocument()
    expect(screen.getByText(/重みの版を固定していません/)).toBeInTheDocument()
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
        env_id: null,
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

  it('方策を学ぶ環境に, 答えた登録名か, 答えないと自作の環境の雛形を書き出すことを出す', () => {
    const policy = {
      action_limits: null,
      stop: null,
      fallback: null,
      fallback_action: null,
      safety_key: 'cost',
      approver: null,
    }
    const handoff = (env_id: string | null): Handoff => ({
      ...POINT_CLOUD,
      part: { ...POINT_CLOUD.part, role: 'effect', target_process: null },
      policy: { ...policy, env_id },
    })
    const envQuestion = (value: string | null, applies = true): Question => ({
      ...choice('ml.parts.0.env_id', value, []),
      kind: 'text',
      required: false,
      applies,
    })
    const { rerender } = render(
      <HandoffCard problem={problemWith(handoff('CartPole-v1'), [envQuestion('CartPole-v1')])} />,
    )
    expect(screen.getByText('方策を学ぶ環境 (学習, 評価)')).toBeInTheDocument()
    expect(screen.getByText('CartPole-v1')).toBeInTheDocument()
    expect(screen.getByText(/config の env\.id に書き/)).toBeInTheDocument()
    expect(screen.queryByText(/自作の環境の雛形/)).not.toBeInTheDocument()

    // 答えていなければ, 自作の環境の雛形を書き出すことと答え方を添える
    rerender(<HandoffCard problem={problemWith(handoff(null), [envQuestion(null)])} />)
    expect(screen.getByText(/自作の環境 \(環境の登録名は答えていません\)/)).toBeInTheDocument()
    expect(
      screen.getByText(/骨組みには自作の環境の雛形 \(env\.py\) を書き出す/),
    ).toBeInTheDocument()

    // 問いへ移れるときは, 問いの節と題をリンクにする
    const onJump = vi.fn()
    rerender(
      <HandoffCard problem={problemWith(handoff(null), [envQuestion(null)])} onJump={onJump} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '5 の「ml.parts.0.env_id」' }))
    expect(onJump).toHaveBeenCalledWith('ml.parts.0.env_id')

    // 今ある記録から学ぶ (問いが要らない) ときは出さない
    rerender(<HandoffCard problem={problemWith(handoff(null), [envQuestion(null, false)])} />)
    expect(screen.queryByText(/方策を学ぶ環境/)).not.toBeInTheDocument()
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
  it('相手をまとめる列の役目を, 分割の名前でなく grouped で出す', () => {
    const questions = [choice('ml.parts.0.task', 'classification', [['classification', '分類']])]
    const column = (split: string, group: string | null): Problem =>
      problemWith(
        {
          ...POINT_CLOUD,
          part: { ...POINT_CLOUD.part, target_kind: 'column', target_process: null },
          data: {
            ...POINT_CLOUD.data,
            target: 'churn',
            task: 'classification',
            split,
            group_column: group,
          },
          model: {
            task: 'classification',
            outputs: 2,
            role: 'predict',
            target_kind: 'column',
            example: null,
          },
        },
        questions,
      )
    // グループを使う分割は同じ値を同じ分割に, 他は重なりの確かめ
    expect(SPLITS.filter((split) => split.grouped).map((split) => split.value)).toEqual([
      'group',
      'group_time',
      'stratified_group',
    ])
    for (const split of SPLITS) {
      const { unmount } = render(
        <HandoffCard problem={column(split.value, 'customer')} splits={SPLITS} />,
      )
      expect(screen.getByText(/相手をまとめる列/)).toHaveTextContent(
        split.grouped ? '(同じ値を同じ分割に)' : '(分割をまたぐ重なりを確かめる)',
      )
      unmount()
    }
    // 名前でなく目印で決める (画面の知らない名前でも目印に従う)
    const added = [...SPLITS, { value: 'new_group', label: '新しい分け方', grouped: true }]
    const { unmount } = render(
      <HandoffCard problem={column('new_group', 'customer')} splits={added} />,
    )
    expect(screen.getByText(/相手をまとめる列/)).toHaveTextContent('(同じ値を同じ分割に)')
    unmount()
    // 列の無い分割では出さない
    for (const split of SPLITS) {
      const { unmount: off } = render(
        <HandoffCard problem={column(split.value, null)} splits={SPLITS} />,
      )
      expect(screen.queryByText(/相手をまとめる列/)).not.toBeInTheDocument()
      off()
    }
    // grouped が分からない間 (分割の名前を読む前, 目印の無い古い値) は役目を出さない
    for (const splits of [[], [{ value: 'group', label: '相手ごと' }]]) {
      const { unmount: off } = render(
        <HandoffCard problem={column('group', 'customer')} splits={splits} />,
      )
      const row = screen.getByText(/相手をまとめる列/)
      expect(row).not.toHaveTextContent('同じ値を同じ分割に')
      expect(row).not.toHaveTextContent('重なりを確かめる')
      off()
    }
  })
})
