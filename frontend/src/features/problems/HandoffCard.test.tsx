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
    expect(screen.getByText(/画像と表の生成とまとめるは分割を,/)).toBeInTheDocument()
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

  it('並べるは, 並べる件数 K と反応の表の列の役割と, 時刻の順の分割を出す', () => {
    const rank: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        role: 'rank',
        unit: 'query',
        output: 'ranking',
        target_kind: null,
        target_source: 'feedback',
        target_process: null,
      },
      data: { ...POINT_CLOUD.data, split: 'time', time_column: 'ts' },
      model: {
        ...POINT_CLOUD.model,
        role: 'rank',
        target_kind: null,
        example: 'two_tower_retrieval',
      },
      training: {
        metric: 'ndcg',
        monitor: 'valid/ndcg',
        mode: 'max',
        role: 'rank',
        target_kind: null,
      },
      rank: { user: 'member', item: 'item_id', time: 'ts', reaction: 'qty', k: 10 },
    }
    const questions = [
      choice('ml.parts.0.role', 'rank', [['rank', '並べる (多くの候補から要求に合うものを順に)']]),
      choice('ml.parts.0.output', 'ranking', [['ranking', '順位']]),
    ]
    const { rerender } = render(
      <HandoffCard problem={problemWith(rank, questions)} splits={SPLITS} />,
    )
    expect(screen.getByText('受け持ち: 並べる')).toBeInTheDocument()
    expect(screen.getByText(/利用者ごとに上位 10 件を並べる/)).toHaveTextContent(
      'Recall@K と NDCG もこの K で数える',
    )
    expect(screen.getByText(/利用者の列/)).toHaveTextContent(
      '利用者の列 member (利用者ごとに品物を並べる)',
    )
    expect(screen.getByText(/^品物の列/)).toHaveTextContent('品物の列 item_id (並べる品物)')
    expect(screen.getByText(/^反応の時刻の列/)).toHaveTextContent(
      '反応の時刻の列 ts (古い反応で学び, 新しい反応で確かめる)',
    )
    expect(screen.getByText(/^反応の強さの列/)).toHaveTextContent(
      '反応の強さの列 qty (0 より大きい行だけを反応とみなす)',
    )
    expect(screen.getByText(/分割は時刻の順/)).toHaveTextContent('反応の時刻の列 ts の順')
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent('two_tower_retrieval')
    expect(screen.getByText(/推論に使う一式を実験の inference\/ に作ります/)).toBeInTheDocument()

    // 反応の強さの列を答えなければ, 全ての行を反応とみなすことを出す
    rerender(
      <HandoffCard
        problem={problemWith({ ...rank, rank: { ...rank.rank!, reaction: null } }, questions)}
        splits={SPLITS}
      />,
    )
    expect(screen.getByText(/^反応の強さの列/)).toHaveTextContent(
      '反応の強さの列: 無し (全ての行を反応とみなす)',
    )

    // 並べるでなければ並べ方を出さない
    rerender(<HandoffCard problem={problemWith(POINT_CLOUD, [])} splits={SPLITS} />)
    expect(screen.queryByText(/並べ方/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/推論に使う一式を実験の inference\/ に作ります/),
    ).not.toBeInTheDocument()
  })

  it('まとめるは, 群の数, 群を作る列, 数え方の言葉と, 評価が群の安定性と群の要約であることを出す', () => {
    const group: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        role: 'group',
        unit: 'row',
        output: 'cluster',
        target_kind: null,
        target_source: 'none',
        target_process: null,
      },
      data: { ...POINT_CLOUD.data, split: 'random' },
      model: {
        ...POINT_CLOUD.model,
        role: 'group',
        target_kind: null,
        example: 'contrastive_encoder',
      },
      training: {
        metric: 'silhouette',
        monitor: 'valid/silhouette',
        mode: 'max',
        role: 'group',
        target_kind: null,
      },
      group: {
        columns: ['spend', 'visits', 'region'],
        id: 'customer',
        k: 3,
        stability: 'sample',
      },
    }
    const stability = choice('ml.parts.0.group.stability', 'sample', [
      ['seed', '種を変えて作り直す (同じ行で, 群の中心の初めの置き方を変える)'],
      ['sample', '標本を変えて作り直す (行の 8 割を引き直す)'],
    ])
    const questions = [
      choice('ml.parts.0.role', 'group', [
        ['group', 'まとめる (正解の無いデータを, 人が分かるまとまりに)'],
      ]),
      choice('ml.parts.0.output', 'cluster', [['cluster', '群']]),
      stability,
      {
        ...choice('ml.parts.0.evaluation.metric', 'silhouette', [
          ['silhouette', '群のまとまり (シルエット係数. 大きいほど良い)'],
        ]),
        section: 8,
      },
    ]
    const { rerender } = render(
      <HandoffCard problem={problemWith(group, questions)} splits={SPLITS} />,
    )
    expect(screen.getByText('受け持ち: まとめる')).toBeInTheDocument()
    expect(screen.getByText(/3 つの群に分ける/)).toHaveTextContent('群の数')
    expect(screen.getByText(/^群を作る列/)).toHaveTextContent(/群を作る列\s*spendvisitsregion/)
    expect(screen.getByText(/^行を見分ける列/)).toHaveTextContent(
      '行を見分ける列 customer (群の割り当ての表に書く. 群を作るのには使わない)',
    )
    expect(screen.getByText(/群の安定性の数え方/)).toHaveTextContent(
      '群の安定性の数え方: 標本を変えて作り直す (行の 8 割を引き直す)',
    )
    expect(screen.getByText(/^評価は群の安定性/)).toHaveTextContent('群の要約')
    expect(screen.getByText(/分割は無作為/)).toBeInTheDocument()
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent('contrastive_encoder')
    expect(screen.getByText(/監視する指標/)).toHaveTextContent(
      '監視する指標 valid/silhouette (群のまとまり)',
    )
    expect(screen.getByText(/推論の一式は作りません/)).toHaveTextContent('群の中心')
    expect(screen.getByText(/守る指標を問いません/)).toBeInTheDocument()
    // 数え方の値の名前は出さない
    expect(screen.queryByText(/\bsample\b/)).not.toBeInTheDocument()

    // 行を見分ける列が無ければ行の番号, 数え方を答えていなければ答えていないと出す
    rerender(
      <HandoffCard
        problem={problemWith({ ...group, group: { ...group.group!, id: null, stability: null } }, [
          ...questions.filter((q) => q !== stability),
          { ...stability, value: null },
        ])}
        splits={SPLITS}
      />,
    )
    expect(screen.getByText(/^行を見分ける列/)).toHaveTextContent(
      '無し (群の割り当ての表には行の番号を書く)',
    )
    expect(screen.getByText(/群の安定性の数え方/)).toHaveTextContent('まだ答えていません')

    // まとめるでなければまとめ方を出さない
    rerender(<HandoffCard problem={problemWith(POINT_CLOUD, [])} splits={SPLITS} />)
    expect(screen.queryByText(/まとめ方/)).not.toBeInTheDocument()
    expect(screen.queryByText(/守る指標を問いません/)).not.toBeInTheDocument()
  })

  it('異常の検知は, 度合いの決め方の言葉, 件数の上限と K, 正解の有る無しの評価と振り分けを出す', () => {
    const anomaly: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        unit: 'row',
        output: 'value',
        target_kind: 'anomaly',
        target_source: 'few',
        target_process: null,
      },
      data: {
        ...POINT_CLOUD.data,
        target: 'is_anomaly',
        task: 'anomaly',
        split: 'random',
        known: ['temp', 'vibration'],
        drop: ['memo'],
        id: 'reading_id',
        unlabeled: 'normal',
      },
      model: {
        ...POINT_CLOUD.model,
        target_kind: 'anomaly',
        outputs: 2,
        example: 'tabular_autoencoder',
      },
      training: {
        metric: 'average_precision',
        monitor: 'valid/average_precision',
        mode: 'max',
        role: 'predict',
        target_kind: 'anomaly',
      },
      inference: {
        decision: { type: 'triage', capacity: 20 },
        conclusion: {},
        horizon: null,
        guard: null,
        ready: null,
      },
      anomaly: {
        score: 'autoencoder',
        label: 'is_anomaly',
        id: 'reading_id',
        columns: ['temp', 'vibration'],
        capacity: 20,
        k: 20,
      },
    }
    const score = choice('ml.parts.0.anomaly.score', 'autoencoder', [
      ['autoencoder', '正常の行だけで学ぶ自己符号化器の再構成の誤差 (行ごとの二乗誤差の平均)'],
      ['distance', '学習用の正常の行の中心からの距離 (Mahalanobis 距離. 学習しない)'],
    ])
    const questions = [
      choice('ml.parts.0.role', 'predict', [['predict', '予測する (当てる)']]),
      choice('ml.parts.0.target.kind', 'anomaly', [
        ['anomaly', '異常か正常か (正常の行が多い表. 正解は無いか少しだけ)'],
      ]),
      choice('ml.parts.0.target.source', 'few', [
        ['none', '無い'],
        ['few', '少し (確かめの組だけ)'],
      ]),
      score,
      { ...choice('action.decision', null, [['triage', '振り分ける (人が確かめる, 再検査)']]) },
    ]
    const { rerender } = render(
      <HandoffCard problem={problemWith(anomaly, questions)} splits={SPLITS} />,
    )
    expect(screen.getByText('正解の種類: 異常か正常か')).toBeInTheDocument()
    expect(screen.getByText(/^異常の正解の列/)).toHaveTextContent(
      '異常の正解の列 is_anomaly (正解の欠けた行は正常と見なす)',
    )
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('reading_id')
    expect(screen.getByText(/分割は無作為/)).toHaveTextContent('学習用は正常の行だけ')
    expect(screen.getByText(/^度合いに使う列/)).toHaveTextContent(/temp\s*vibration/)
    expect(screen.getByText(/度合いの決め方:/)).toHaveTextContent(
      '度合いの決め方: 正常の行だけで学ぶ自己符号化器の再構成の誤差 (大きいほど異常)',
    )
    expect(screen.getByText(/件数の上限は 20 件/)).toHaveTextContent('K は 20')
    expect(screen.getByText(/上位 K 件の適合率と PR-AUC/)).toBeInTheDocument()
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent('tabular_autoencoder')
    expect(screen.getByText(/出力の大きさ 2/)).toBeInTheDocument()
    expect(screen.getByText(/監視する指標/)).toHaveTextContent('valid/average_precision')
    expect(screen.getByText(/^意思決定:/)).toHaveTextContent('意思決定: 振り分ける件数の上限: 20')
    expect(screen.getByText(/度合いの高い順に, 件数の上限まで/)).toBeInTheDocument()
    expect(screen.getByText(/異常の度合いの一式/)).toHaveTextContent('仮のモデルでは作らない')
    // 列の予測の欄と守る指標は出さない
    expect(screen.queryByText(/目的の列/)).not.toBeInTheDocument()
    expect(screen.queryByText(/守る指標:/)).not.toBeInTheDocument()
    // 値の名前は出さない
    expect(screen.queryByText(/\bautoencoder\b/)).not.toBeInTheDocument()

    // 正解が無く距離なら, 全てを正常と見なし, 分布と上位の行の要約で見て, モデルと学習の欄は無い
    rerender(
      <HandoffCard
        problem={problemWith(
          {
            ...anomaly,
            part: { ...anomaly.part, target_source: 'none' },
            data: { ...anomaly.data, target: null, unlabeled: null },
            model: { ...anomaly.model, example: null },
            training: { ...anomaly.training, metric: null, monitor: null, mode: null },
            anomaly: { ...anomaly.anomaly!, score: 'distance', label: null, id: null },
          },
          [...questions.filter((q) => q !== score), { ...score, value: 'distance' }],
        )}
        splits={SPLITS}
      />,
    )
    expect(screen.getByText(/^異常の正解の列/)).toHaveTextContent('無し (全ての行を正常と見なす)')
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('無し (行の位置で指す)')
    expect(screen.getByText(/度合いの決め方:/)).toHaveTextContent(
      '学習用の正常の行の中心からの距離',
    )
    expect(screen.getByText(/度合いの分布と上位 K 行の要約/)).toBeInTheDocument()
    expect(screen.getByText(/学習の繰り返しはありません/)).toBeInTheDocument()
    expect(screen.getByText(/モデルは作りません/)).toBeInTheDocument()
    expect(screen.queryByText(/監視する指標/)).not.toBeInTheDocument()
    expect(screen.getByText(/異常の度合いの一式/)).not.toHaveTextContent('仮のモデル')
  })

  it('効果の見積もりは, 処置と結果の列, 効果の意味, K と配る数の上限, 群の差の評価と配る判断を出す', () => {
    const uplift: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        role: 'effect',
        unit: 'row',
        output: 'effect',
        target_kind: null,
        target_source: 'intervention',
        target_process: null,
      },
      data: {
        ...POINT_CLOUD.data,
        target: 'purchased',
        task: 'uplift',
        split: 'stratified',
        known: ['age', 'visits'],
        drop: ['used'],
        id: 'customer_id',
        treatment: 'coupon',
        outcome_kind: 'binary',
        unlabeled: 'drop',
      },
      model: {
        ...POINT_CLOUD.model,
        role: 'effect',
        target_kind: null,
        outputs: 1,
        example: 'tabular_uplift',
      },
      training: {
        metric: 'qini',
        monitor: 'valid/qini',
        mode: 'max',
        role: 'effect',
        target_kind: null,
      },
      inference: {
        decision: { type: 'treat', budget: 500 },
        conclusion: {},
        horizon: null,
        guard: null,
        ready: null,
      },
      uplift: {
        treatment: 'coupon',
        outcome: 'purchased',
        outcome_kind: 'binary',
        id: 'customer_id',
        columns: ['age', 'visits'],
        k: 0.3,
      },
    }
    const kind = choice('ml.parts.0.uplift.outcome_kind', 'binary', [
      ['binary', '起きたか (買ったかの 0 と 1. 効果は確率の差)'],
      ['amount', '量 (買った額. 効果は値の差)'],
    ])
    const decision: Question = {
      ...choice('action.decision', { type: 'treat', budget: 500 }, []),
      choices: [
        {
          value: 'treat',
          label: '効果の上位から配る (クーポン, 案内)',
          fields: [
            { key: 'budget', label: '配る数の上限 (守る指標. 1 以上の整数)', required: true },
          ],
        },
      ],
    }
    const questions = [
      choice('ml.parts.0.role', 'effect', [
        ['effect', '効果を見積もる (行動したときとしないときの差)'],
      ]),
      choice('ml.parts.0.output', 'effect', [['effect', '行動ごとの差']]),
      choice('ml.parts.0.target.source', 'intervention', [
        ['intervention', '介入の記録 (無作為の試験, 記録した方策の確率)'],
      ]),
      kind,
      decision,
    ]
    const { rerender } = render(
      <HandoffCard problem={problemWith(uplift, questions)} splits={SPLITS} />,
    )
    expect(screen.getByText('受け持ち: 効果を見積もる')).toBeInTheDocument()
    expect(screen.getByText('正解の出どころ: 介入の記録')).toBeInTheDocument()
    expect(screen.getByText(/^処置の列/)).toHaveTextContent('coupon')
    expect(screen.getByText(/^処置の列/)).toHaveTextContent('無作為に配った記録を前提にする')
    expect(screen.getByText(/^結果の列/)).toHaveTextContent('結果の列 purchased (起きたか)')
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('customer_id')
    expect(screen.getByText(/分割は層別/)).toHaveTextContent('対照の群 (配らなかった行) が入る')
    expect(screen.getByText(/^見積もりに使う列/)).toHaveTextContent(/age\s*visits/)
    expect(screen.getByText(/^除く列/)).toHaveTextContent('used')
    expect(screen.getByText('結果の欠けた行は落とす')).toBeInTheDocument()
    expect(screen.getByText(/^効果は, 処置したとき/)).toHaveTextContent('確率の差')
    expect(screen.getByText(/見るか\) は 0\.3/)).toHaveTextContent('配る数の上限は 500 (守る指標)')
    expect(screen.getByText(/顧客ごとの正解の効果は見えない/)).toHaveTextContent(
      'でたらめに配るよりどれだけ良いか), 上位 K 割の効果の差 (処置の群と対照の群の結果の平均の差)',
    )
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent('tabular_uplift')
    expect(screen.getByText(/^出力は処置したとき/)).toHaveTextContent('それぞれの大きさ 1')
    expect(screen.getByText(/監視する指標/)).toHaveTextContent('valid/qini')
    expect(screen.getByText(/^意思決定:/)).toHaveTextContent(
      '意思決定: 効果の上位から配る配る数の上限: 500',
    )
    expect(screen.getByText(/効果の高い順に, 配る数の上限まで/)).toBeInTheDocument()
    expect(screen.getByText(/uplift_estimator\.json/)).toHaveTextContent('uplift_effects.csv')
    // 列の予測の欄と守る指標は出さない
    expect(screen.queryByText(/目的の列/)).not.toBeInTheDocument()
    expect(screen.queryByText(/守る指標:/)).not.toBeInTheDocument()
    // 値の名前は出さない
    expect(screen.queryByText(/\bbinary\b/)).not.toBeInTheDocument()

    // 量で行の id が無ければ, 値の差と行の位置
    rerender(
      <HandoffCard
        problem={problemWith(
          {
            ...uplift,
            data: { ...uplift.data, id: null, outcome_kind: 'amount' },
            uplift: { ...uplift.uplift!, id: null, outcome_kind: 'amount' },
          },
          [...questions.filter((q) => q !== kind), { ...kind, value: 'amount' }],
        )}
        splits={SPLITS}
      />,
    )
    expect(screen.getByText(/^結果の列/)).toHaveTextContent('(量)')
    expect(screen.getByText(/^効果は, 処置したとき/)).toHaveTextContent('値の差')
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('無し (行の位置で指す)')
  })

  it('値段を変える判断は, 値段と売れた数と原価の列, 今の値段, 候補と上限, 評価と値段の判断を出す', () => {
    const price: Handoff = {
      ...POINT_CLOUD,
      part: {
        ...POINT_CLOUD.part,
        role: 'effect',
        unit: 'row',
        output: 'effect',
        target_kind: null,
        target_source: 'intervention',
        target_process: null,
      },
      data: {
        ...POINT_CLOUD.data,
        target: 'units',
        task: 'price',
        split: 'stratified',
        known: ['category', 'weekday', 'price'],
        drop: ['left'],
        id: 'record_id',
        price: 'price',
        cost: 'unit_cost',
        product: 'product_id',
        unlabeled: 'drop',
      },
      model: {
        ...POINT_CLOUD.model,
        role: 'effect',
        target_kind: null,
        outputs: 1,
        example: 'tabular_price',
      },
      training: {
        metric: 'mae',
        monitor: 'valid/mae',
        mode: 'min',
        role: 'effect',
        target_kind: null,
      },
      inference: {
        decision: { type: 'price', candidates: [-0.1, -0.05, 0, 0.05, 0.1], max_change: 0.1 },
        conclusion: {},
        horizon: null,
        guard: null,
        ready: null,
      },
      price: {
        price: 'price',
        units: 'units',
        cost: 'unit_cost',
        product: 'product_id',
        id: 'record_id',
        columns: ['category', 'weekday'],
      },
    }
    const decision: Question = {
      ...choice(
        'action.decision',
        { type: 'price', candidates: [-0.1, -0.05, 0, 0.05, 0.1], max_change: 0.1 },
        [],
      ),
      choices: [
        {
          value: 'price',
          label: '利益が最も大きい値段を選ぶ (商品ごとの値段)',
          fields: [
            {
              key: 'candidates',
              label: '値段の候補 (今の値段に対する変える割合の並び. 0 を含む. 1 割上げるなら 0.1)',
              required: true,
              list: true,
            },
            {
              key: 'max_change',
              label: '値段を変える幅の上限 (守る指標. 変える割合の絶対値. 1 割までなら 0.1)',
              required: true,
            },
          ],
        },
      ],
    }
    const questions = [
      choice('ml.parts.0.role', 'effect', [
        ['effect', '効果を見積もる (行動したときとしないときの差)'],
      ]),
      choice('ml.parts.0.output', 'effect', [['effect', '行動ごとの差']]),
      choice('ml.parts.0.target.source', 'intervention', [
        ['intervention', '介入の記録 (無作為の試験, 記録した方策の確率)'],
      ]),
      decision,
    ]
    const { rerender } = render(
      <HandoffCard problem={problemWith(price, questions)} splits={SPLITS} />,
    )
    expect(screen.getByText('受け持ち: 効果を見積もる')).toBeInTheDocument()
    expect(screen.getByText(/^値段の列/)).toHaveTextContent('price')
    expect(screen.getByText(/^値段の列/)).toHaveTextContent('試しに値段を変えた記録 (無作為に近い)')
    expect(screen.getByText(/^売れた数の列/)).toHaveTextContent('units (その値段で売れた数')
    expect(screen.getByText(/^原価の列/)).toHaveTextContent('unit_cost (商品 1 つを')
    expect(screen.getByText(/^商品の id の列/)).toHaveTextContent('product_id (値段を選ぶ単位')
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('record_id')
    expect(screen.getByText(/分割は層別/)).toHaveTextContent('値段の段で層を作る')
    expect(screen.getByText(/^予測に使う列/)).toHaveTextContent(/category\s*weekday/)
    expect(screen.getByText(/^除く列/)).toHaveTextContent('left')
    expect(screen.getByText('売れた数の欠けた行は落とす')).toBeInTheDocument()
    expect(screen.getByText(/^今の値段は/)).toHaveTextContent('商品ごとの記録の値段の中央値')
    expect(screen.getByText(/^値段の候補 \(/)).toHaveTextContent('-10 %, -5 %, 0 %, +5 %, +10 %')
    expect(screen.getByText(/^値段の候補 \(/)).toHaveTextContent('今の値段 × (1 + 割合)')
    expect(screen.getByText(/^値段を変える幅の上限 \(/)).toHaveTextContent('守る指標')
    expect(screen.getByText(/^値段を変える幅の上限 \(/)).toHaveTextContent('は 10 %')
    expect(screen.getByText(/^利益は/)).toHaveTextContent('(値段 − 原価) × 予測した売れた数')
    expect(screen.getByText(/弾力性 \(値段を 1 %/)).toHaveTextContent('見込みの利益の比べ')
    expect(screen.getByText(/モデルの作成の雛形/)).toHaveTextContent('tabular_price')
    expect(screen.getByText(/^入力の最後の列が値段/)).toHaveTextContent(
      '売れた数の予測 units (大きさ 1)',
    )
    expect(screen.getByText(/監視する指標/)).toHaveTextContent('valid/mae')
    expect(screen.getByText(/^意思決定:/)).toHaveTextContent(
      '意思決定: 利益が最も大きい値段を選ぶ値段の候補: -0.1, -0.05, 0, 0.05, 0.1値段を変える幅の上限: 0.1',
    )
    expect(screen.getByText(/^商品ごとに, 値段を変える幅の上限を超えない/)).toBeInTheDocument()
    expect(screen.getByText(/price_estimator\.json/)).toHaveTextContent('price_choices.csv')
    expect(screen.getByText(/値段を試して確かめます/)).toBeInTheDocument()
    // 列の予測と効果の見積もりの欄と守る指標は出さない
    expect(screen.queryByText(/目的の列/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^処置の列/)).not.toBeInTheDocument()
    expect(screen.queryByText(/守る指標:/)).not.toBeInTheDocument()

    // 原価, 商品と行の id が無ければ, 売上で選び, 行ごとに選び, 今の値段は行の値段
    rerender(
      <HandoffCard
        problem={problemWith(
          {
            ...price,
            data: { ...price.data, id: null, cost: null, product: null },
            price: { ...price.price!, id: null, cost: null, product: null },
          },
          questions,
        )}
        splits={SPLITS}
      />,
    )
    expect(screen.getByText(/^原価の列/)).toHaveTextContent('無し (原価を 0 とし, 売上で選ぶ)')
    expect(screen.getByText(/^商品の id の列/)).toHaveTextContent('無し (行ごとに値段を選ぶ)')
    expect(screen.getByText(/^行の id の列/)).toHaveTextContent('無し (行の位置で指す)')
    expect(screen.getByText(/^今の値段は/)).toHaveTextContent('その行の記録の値段')
  })

  it('守る指標のたどり直しで数える量を, 名前でなく選択肢の言葉で出す', () => {
    const column: Handoff = {
      ...POINT_CLOUD,
      part: { ...POINT_CLOUD.part, target_kind: 'column', target_process: null },
      data: { ...POINT_CLOUD.data, target: 'sales', task: 'regression', split: 'time' },
      model: {
        task: 'regression',
        outputs: 1,
        role: 'predict',
        target_kind: 'column',
        example: null,
      },
      inference: {
        ...POINT_CLOUD.inference,
        guard: {
          name: '品切れの割合',
          unit: '割合. 0 から 1',
          better: 'lower',
          line: 0.05,
          measure: null,
          counted: 'shortage_rate',
        },
      },
    }
    // 選択肢は ML-Quest が今の意思決定の型に合うものに絞って返す
    const counted = {
      ...choice('issue.guard.counted', 'shortage_rate', [
        ['shortage_rate', '足りなかった行の割合'],
        ['shortage', '足りなかった量の合計 (目的の列の単位)'],
        ['none', '指さない (過去のデータでは数えられない. 課題の場で数える)'],
      ]),
      section: 7,
    }
    const { rerender } = render(<HandoffCard problem={problemWith(column, [counted])} />)
    expect(screen.getByText(/守る指標:/)).toHaveTextContent(
      '守る指標: 品切れの割合 (小さいほど良い). 守る線は 0.05 (割合. 0 から 1)',
    )
    expect(screen.getByText(/たどり直しで数える量/)).toHaveTextContent(
      'たどり直しで数える量: 足りなかった行の割合',
    )
    expect(screen.queryByText(/shortage_rate/)).not.toBeInTheDocument()

    // 指さないと答えれば, その言葉を出す
    const none: Handoff = {
      ...column,
      inference: { ...column.inference, guard: { ...column.inference.guard!, counted: null } },
    }
    rerender(<HandoffCard problem={problemWith(none, [{ ...counted, value: 'none' }])} />)
    expect(screen.getByText(/たどり直しで数える量/)).toHaveTextContent('課題の場で数える')

    // 答えていなければ数える量の行を出さない. 守る指標が無ければ守る指標も出さない
    rerender(<HandoffCard problem={problemWith(none, [{ ...counted, value: null }])} />)
    expect(screen.queryByText(/たどり直しで数える量/)).not.toBeInTheDocument()
    rerender(
      <HandoffCard
        problem={problemWith({ ...column, inference: { ...column.inference, guard: null } }, [])}
      />,
    )
    expect(screen.queryByText(/守る指標:/)).not.toBeInTheDocument()
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
