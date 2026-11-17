import type { Problem } from '../../api/types'
import { Card } from '../../components/ui'
import { DECISION_FIELDS, DECISION_NAMES } from '../../lib/labels'

/** タスクの名前 */
const TASKS: Record<string, string> = {
  classification: '分類',
  regression: '回帰',
  forecasting: '時系列の予測',
}

/** 1 行の値 (コードの形) */
function Code({ children }: { children: string }) {
  return <code className="rounded bg-surface-2 px-1 font-mono text-xs">{children}</code>
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
              ? '4 の「機械学習を使いますか」で使うと決めると, データの分析, モデルの作成, 学習, 推論の各段階で選ぶ値がここに出ます.'
              : `まだ渡せません. ${problem.handoff_error ?? ''}`}
        </p>
      </Card>
    )
  const { data, model, training, inference } = handoff
  const decision = inference.decision
  return (
    <Card title="後ろの段階に渡す値">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析 (ML-Fathom)</dt>
          <dd className="flex flex-col gap-1">
            <span>
              目的の列 <Code>{data.target}</Code>, {TASKS[data.task] ?? data.task}, 分割は
              {data.split === 'time' ? '時刻の順' : '無作為'}
            </span>
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
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">学習 (ML-Found, ML-Dashboard)</dt>
          <dd>
            監視する指標 <Code>{training.monitor}</Code> (
            {training.mode === 'max' ? '大きい' : '小さい'}
            ほど良い)
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論 (ML-Provide)</dt>
          <dd className="flex flex-col gap-1">
            <span>
              意思決定: {decision ? DECISION_NAMES[decision.type] : 'しない (人が予測を見て決める)'}
            </span>
            {decision && (
              <span className="flex flex-wrap gap-1">
                {Object.entries(decision)
                  .filter(([key]) => key !== 'type')
                  .map(([key, value]) => (
                    <Code key={key}>{`${
                      DECISION_FIELDS[decision.type]?.find((f) => f.key === key)?.label ??
                      (key === 'positive' ? '当たりのクラス' : key)
                    }: ${String(value)}`}</Code>
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
