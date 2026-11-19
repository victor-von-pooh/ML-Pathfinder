import type { Choice, Problem } from '../../api/types'
import { Card } from '../../components/ui'

/** 分割の名前 (ML-EDA の分け方) */
const SPLITS: Record<string, string> = {
  time: '時刻の順',
  group: '相手ごと',
  random: '無作為',
  stratified: '層別',
}

/** 受け持ちの問いの識別子の頭 (ML-Quest の版 2. 受け持ちは今は 1 つ) */
const PART = 'ml.parts.0'

/** 問いの選択肢 (ML-Quest が返すもの) */
function choicesOf(problem: Problem, id: string): Choice[] {
  return problem.questions.find((question) => question.id === id)?.choices ?? []
}

/** 選択肢の短い名前 (説明の括弧の前まで) */
function shortLabel(choices: Choice[], value: string): string {
  return choices.find((choice) => choice.value === value)?.label.split(' (')[0] ?? value
}

/** 受け持ちの問いの答えの短い名前 (答えが無ければ null) */
function partLabel(problem: Problem, key: string, value: string | null): string | null {
  return value === null ? null : shortLabel(choicesOf(problem, `${PART}.${key}`), value)
}

/** 1 行の値 (コードの形) */
function Code({ children }: { children: string }) {
  // 長い値 (データの場所など) は欄の中で折り返す
  return (
    <code className="rounded bg-surface-2 px-1 font-mono text-xs [overflow-wrap:anywhere]">
      {children}
    </code>
  )
}

/** 名前の並び */
function Names({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-ink-3">なし</span>
  return (
    <span className="flex flex-wrap gap-1">
      {names.map((name) => (
        <Code key={name}>{name}</Code>
      ))}
    </span>
  )
}

/** 学習の段階に渡す, 監視する指標と向き (その他の指標は記録の頼み) */
function TrainingRow({ problem }: { problem: Problem }) {
  const training = problem.handoff?.training
  if (!training) return null
  const other =
    problem.questions.find((q) => q.id === `${PART}.evaluation.metric`)?.value === 'other'
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習 (ML-Found, ML-Dashboard)</dt>
      <dd className="flex flex-col gap-1">
        <span>
          監視する指標 <Code>{training.monitor}</Code> (
          {training.mode === 'max' ? '大きい' : '小さい'}
          ほど良い)
        </span>
        {other && (
          <span className="text-xs text-ink-2">
            その他の指標です. 学習で検証用の分割の <Code>{training.monitor}</Code>{' '}
            を記録するようにしてください
          </span>
        )}
      </dd>
    </div>
  )
}

/**
 * 方策の守り (方策と答えたときだけ). 方策を使ってよいかと守りの範囲は人が決め,
 * 実機で動かすのは道具の外であることを添える
 */
function PolicyRow({ problem }: { problem: Problem }) {
  const policy = problem.handoff?.policy
  if (!policy) return null
  const fallback = partLabel(problem, 'policy.fallback', policy.fallback)
  const action = policy.fallback_action
  const rows: [string, string | null][] = [
    ['行動の上限', policy.action_limits],
    ['止める条件', policy.stop],
    ['外れたときの動き', fallback],
    [
      '決めた行動',
      action === null || action === undefined
        ? null
        : Array.isArray(action)
          ? action.join(', ')
          : String(action),
    ],
    ['安全の違反の信号', policy.safety_key],
    ['決める人', policy.approver],
  ]
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">方策の守り (学習, 評価, 推論)</dt>
      <dd className="flex flex-col gap-1">
        {rows
          .filter(([, value]) => value !== null && value !== '')
          .map(([name, value]) => (
            <span key={name} className="whitespace-pre-line">
              {name}: {value}
            </span>
          ))}
        <span className="text-xs text-ink-2">
          方策を使ってよいか (実機に出してよいか) と守りの範囲は,{' '}
          {policy.approver
            ? `人 (${policy.approver}) が決めます.`
            : '人が決めます (決める人はまだ答えていません).'}
          道具は方策を作り, 確かめ, 守りと一緒に書き出すところまでで, 実機で動かすのは道具の外です.
        </span>
      </dd>
    </div>
  )
}

/** 要る機能の名前 (ML-Quest の FEATURES の見出し. 入れ方は画面の上のカード) */
function RequiresRow({ problem }: { problem: Problem }) {
  const names = problem.handoff?.requires ?? []
  if (!names.length) return null
  const labels = new Map(problem.requires.map((item) => [item.name, item.label]))
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習の段階に要る機能</dt>
      <dd className="flex flex-col gap-1">
        <span>{names.map((name) => labels.get(name) ?? name).join(', ')}</span>
        <span className="text-xs text-ink-2">入れ方は画面の上の「学習の段階の準備」に出ます</span>
      </dd>
    </div>
  )
}

/** 列の予測でない受け持ちの値 (目的の列, 分割, 意思決定は渡さない) */
function PartHandoff({ problem }: { problem: Problem }) {
  const handoff = problem.handoff
  if (!handoff) return null
  const { part, data } = handoff
  const rows: [string, string | null][] = [
    ['受け持ち', partLabel(problem, 'role', part.role)],
    ['1 件の単位', partLabel(problem, 'unit', part.unit)],
    ['出力の形', partLabel(problem, 'output', part.output)],
    ['正解の種類', partLabel(problem, 'target.kind', part.target_kind)],
    ['正解の出どころ', partLabel(problem, 'target.source', part.target_source)],
    ['作り方', partLabel(problem, 'method', part.method)],
  ]
  return (
    <Card title="後ろの段階に渡す値">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">機械学習の受け持ち</dt>
          <dd className="flex flex-col gap-1">
            {rows
              .filter(([, value]) => value !== null)
              .map(([name, value]) => (
                <span key={name}>
                  {name}: {value}
                </span>
              ))}
            {part.target_process && (
              <span className="flex flex-col gap-1">
                <span>
                  正解を作る処理 <Code>{part.target_process.name}</Code>
                </span>
                {part.target_process.settings && (
                  <span className="whitespace-pre-line">
                    処理の設定: {part.target_process.settings}
                  </span>
                )}
                <span className="text-xs text-ink-2">
                  正解はこの処理の出力なので, 評価と結論はこの処理を超えられません
                </span>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析 (ML-Fathom)</dt>
          <dd className="flex flex-col gap-1">
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (後ろの段階も同じ場所を同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
            <span className="text-xs text-ink-2">
              目的の列, 分割, 使う列は, 列の予測 (予測するで正解の種類が表の列) だけで渡します
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            モデルの作成 (ML-CreateArchitecture)
          </dt>
          <dd>受け持ちと出力の形から選ぶ (出力の大きさは, 列の予測だけで渡します)</dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <PolicyRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論 (ML-Provide)</dt>
          <dd>意思決定の材料は作りません (列の予測だけ)</dd>
        </div>
      </dl>
    </Card>
  )
}

/** 後ろの段階ごとに, 各段階の画面で選ぶ値 */
export function HandoffCard({ problem }: { problem: Problem }) {
  const handoff = problem.handoff
  if (!handoff)
    return (
      <Card title="後ろの段階に渡す値">
        <p className="text-sm text-ink-3">
          {problem.finished
            ? '機械学習を使わないので, 渡す値はありません.'
            : problem.uses_ml !== true
              ? '5 の「機械学習を使いますか」で使うと決めると, データの分析, モデルの作成, 学習, 推論の各段階で選ぶ値がここに出ます.'
              : `まだ渡せません. ${problem.handoff_error ?? ''}`}
        </p>
      </Card>
    )
  // 列の予測でなければ, タスクが無い (受け持ちごとの表示)
  if (handoff.data.task === null) return <PartHandoff problem={problem} />
  const { data, model, inference } = handoff
  const decision = inference.decision
  const type = choicesOf(problem, 'action.decision').find(
    (choice) => choice.value === decision?.type,
  )
  const fields = type?.fields ?? []
  return (
    <Card title="後ろの段階に渡す値">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析 (ML-Fathom)</dt>
          <dd className="flex flex-col gap-1">
            <span>
              目的の列 <Code>{data.target ?? ''}</Code>,{' '}
              {shortLabel(choicesOf(problem, `${PART}.task`), data.task ?? '')}, 分割は
              {SPLITS[data.split ?? ''] ?? data.split}
            </span>
            {data.group_column && (
              <span>
                相手をまとめる列 <Code>{data.group_column}</Code> (
                {data.split === 'group' ? '同じ値を同じ分割に' : '分割をまたぐ重なりを確かめる'})
              </span>
            )}
            {data.time_column && (
              <span>
                時刻の列 <Code>{data.time_column}</Code> (読み込みで日時の列に指定)
              </span>
            )}
            {data.min_lag !== null && data.min_lag !== undefined && (
              <span>
                過去の値の列は {data.min_lag} 期前より古い値だけで作る
                (決める時点で分からない値を使わない)
              </span>
            )}
            {data.series_by.length > 0 && (
              <span className="flex flex-wrap items-center gap-1">
                系列を分ける列 <Names names={data.series_by} />
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1">
              学習に使ってよい列 <Names names={data.known} />
            </span>
            <span className="flex flex-wrap items-center gap-1">
              除く列 <Names names={data.drop} />
            </span>
            {data.source && (
              <span>
                データ <Code>{data.source.source}</Code> (後ろの段階も同じ場所を同じ読み方で開く)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            モデルの作成 (ML-CreateArchitecture)
          </dt>
          <dd>
            出力の大きさ{' '}
            {model.outputs ?? 'クラスの数 (確率にする前の値を出す. softmax は付けない)'}.
            入力の大きさは書き出したデータセットの学習に使う列の数
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <PolicyRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論 (ML-Provide)</dt>
          <dd className="flex flex-col gap-1">
            <span>
              意思決定:{' '}
              {decision ? (type?.label ?? decision.type) : 'しない (人が予測を見て決める)'}
            </span>
            {decision && (
              <span className="flex flex-wrap gap-1">
                {Object.entries(decision)
                  .filter(([key]) => key !== 'type')
                  .map(([key, value]) => (
                    <Code key={key}>{`${
                      fields.find((f) => f.key === key)?.label ??
                      (key === 'positive'
                        ? '当たりのクラス'
                        : key === 'current'
                          ? '今のやり方の列 (たどり直しで比べる)'
                          : key)
                    }: ${
                      fields
                        .find((f) => f.key === key)
                        ?.choices?.find((choice) => choice.value === value)?.label ?? String(value)
                    }`}</Code>
                  ))}
              </span>
            )}
            {inference.horizon !== null && inference.horizon !== undefined && (
              <span>{inference.horizon} 期先まで予測する</span>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  )
}
