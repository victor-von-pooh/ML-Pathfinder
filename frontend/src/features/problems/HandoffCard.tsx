import type { Choice, Problem } from '../../api/types'
import { Card } from '../../components/ui'

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

/** 相手をまとめる列の役目 (分割の grouped から. 分からなければ null) */
function groupRole(splits: Choice[], split: string | null): string | null {
  const grouped = splits.find((choice) => choice.value === split)?.grouped
  if (grouped === undefined) return null
  return grouped ? '同じ値を同じ分割に' : '分割をまたぐ重なりを確かめる'
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
  // 既製のモデルをそのまま使うと学習しない (監視する指標が無い)
  if (!training || training.monitor === null) return null
  const other =
    problem.questions.find((q) => q.id === `${PART}.evaluation.metric`)?.value === 'other'
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習 (ML-Found, ML-Dashboard)</dt>
      <dd className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1">
          監視する指標 <Code>{training.monitor}</Code>
        </span>
        <span className="flex flex-wrap items-center gap-1">
          監視の向き <Code>{training.mode ?? ''}</Code> (
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
 * モデルの作成の雛形 (受け持ちに合う ML-ModelControl の同梱の例の名前). 無ければ理由を言葉で出す
 * (雛形は学習前の定義なので, 一から学習するときだけ渡る)
 */
function ModelExample({ problem }: { problem: Problem }) {
  const handoff = problem.handoff
  if (!handoff) return null
  const example = handoff.model.example
  if (example)
    return (
      <span className="flex flex-wrap items-center gap-1">
        モデルの作成の雛形 (ML-ModelControl の同梱の例の名前) <Code>{example}</Code>
      </span>
    )
  return (
    <span>
      モデルの作成の雛形:{' '}
      <span className="text-ink-3">
        {handoff.part.method === 'scratch'
          ? '受け持ちに合う雛形はありません (モデルの作成の画面で定義を選ぶ)'
          : '一から学習しないので, 合う雛形はありません'}
      </span>
    </span>
  )
}

/** 既製のモデルをそのまま使う予測の推論の欄 (出どころ, モデル, 重み, hash) */
function ReadyRow({ problem }: { problem: Problem }) {
  const ready = problem.handoff?.inference.ready
  if (!ready) return null
  const library = ready.library
    ? shortLabel(choicesOf(problem, `${PART}.ready.library`), ready.library)
    : null
  const rows: [string, string | null][] = [
    ['出どころ', library],
    ['モデル', ready.model],
    ['重み', ready.weights],
    ['重みの hash', ready.sha256],
  ]
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">推論 (ML-Inference, ML-Provide)</dt>
      <dd className="flex flex-col gap-1">
        <span>既製のモデルをそのまま使います (学習しません)</span>
        {rows.map(([name, value]) => (
          <span key={name} className="flex flex-wrap items-center gap-1">
            {name}
            {value ? <Code>{value}</Code> : <span className="text-ink-3">決めていません</span>}
          </span>
        ))}
        {!ready.sha256 && (
          <span className="text-xs text-ink-2">
            hash (重みのファイルの指紋) を決めていないので, 重みの版を固定していません.
            一式を作ると求めた hash が出るので, 問題の設定に書くと次から固定できます
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

/**
 * 方策を学ぶ環境 (方策で, 環境の登録名の問いが要るときだけ). 登録名を答えていれば
 * Gymnasium のその環境, 答えていなければ自作の環境の雛形 (env.py) を骨組みに書き出すことを出す
 */
function EnvRow({ problem, onJump }: { problem: Problem; onJump?: (questionId: string) => void }) {
  const policy = problem.handoff?.policy
  const question = problem.questions.find((item) => item.id === `${PART}.env_id`)
  // 今ある記録から学ぶ (環境とやり取りしない) ときは問いが要らないので出さない
  if (!policy || !question?.applies) return null
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">方策を学ぶ環境 (学習, 評価)</dt>
      <dd className="flex flex-col gap-1">
        {policy.env_id ? (
          <span>
            Gymnasium の <Code>{policy.env_id}</Code> (骨組みは config の env.id に書き,
            登録名で環境を作ります)
          </span>
        ) : (
          <>
            <span>自作の環境 (環境の登録名は答えていません)</span>
            <span className="text-xs text-ink-2">
              骨組みには自作の環境の雛形 (env.py) を書き出すので, 中身 (実機とのつなぎ,
              自作のシミュレータ) は自分で書きます. Gymnasium に登録された環境なら,{' '}
              {onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(question.id)}
                  className="text-accent-text underline"
                >
                  {question.section} の「{question.title}」
                </button>
              ) : (
                `${question.section} の「${question.title}」`
              )}
              に答えると, その環境で学びます.
            </span>
          </>
        )}
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

/**
 * 書き出した学習のプロジェクト. データの分析の書き出し先, モデルの定義の置き場, 学習の
 * プロジェクトは, 後ろの段階のアプリがこの記録から写さずに使う
 */
function ProjectRow({ problem }: { problem: Problem }) {
  const project = problem.project
  if (!project?.path) return null
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習のプロジェクト (書き出した場所)</dt>
      <dd className="flex flex-col gap-1">
        <span>
          プロジェクト <Code>{project.path}</Code>
        </span>
        {project.dataset && (
          <span>
            データセットの書き出し先 <Code>{project.dataset}</Code>
          </span>
        )}
        {project.model_spec && (
          <span>
            モデルの定義の置き場 <Code>{project.model_spec}</Code>
          </span>
        )}
        <span className="text-xs text-ink-2">
          データの分析, モデルの作成, 学習の画面はこの場所を使います (書き出し直すと置き換わる)
        </span>
      </dd>
    </div>
  )
}

/** 列の予測でない受け持ちの値 (目的の列と意思決定は渡さない. ファイルの組は分割とグループ, 画像の生成は分割を渡す) */
function PartHandoff({
  problem,
  splits,
  onJump,
}: {
  problem: Problem
  splits: Choice[]
  onJump?: (questionId: string) => void
}) {
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
            {data.split && (
              <span>
                分割は{shortLabel(splits, data.split)}
                {data.groups && Object.keys(data.groups).length > 0 && (
                  <>
                    {' '}
                    (グループ {new Set(Object.values(data.groups)).size} 種類,{' '}
                    {Object.keys(data.groups).length} 件)
                  </>
                )}
              </span>
            )}
            <span className="text-xs text-ink-2">
              目的の列と使う列は列の予測だけで渡します. ファイルの組 (領域, 点群) は,
              データの分析で書き戻した分割とグループを, 画像の生成は分割を渡します
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            モデルの作成 (ML-CreateArchitecture)
          </dt>
          <dd className="flex flex-col gap-1">
            {handoff.inference.ready ? (
              'モデルは作りません (既製のモデルを使うため)'
            ) : (
              <>
                <ModelExample problem={problem} />
                <span>受け持ちと出力の形から選ぶ (出力の大きさは, 列の予測だけで渡します)</span>
              </>
            )}
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <EnvRow problem={problem} onJump={onJump} />
        <PolicyRow problem={problem} />
        <ProjectRow problem={problem} />
        {handoff.inference.ready ? (
          <ReadyRow problem={problem} />
        ) : (
          <div>
            <dt className="mb-1 text-xs font-medium text-ink-2">推論 (ML-Provide)</dt>
            <dd>意思決定の材料は作りません (列の予測だけ)</dd>
          </div>
        )}
      </dl>
    </Card>
  )
}

/** 後ろの段階ごとに, 各段階の画面で選ぶ値 */
export function HandoffCard({
  problem,
  splits = [],
  onJump,
}: {
  problem: Problem
  /** 受け渡しの分割の値と説明 (/api/info の splits. 読むまでは値のまま出す) */
  splits?: Choice[]
  /** 問いへ移る (環境の登録名の問いへのリンク) */
  onJump?: (questionId: string) => void
}) {
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
  if (handoff.data.task === null)
    return <PartHandoff problem={problem} splits={splits} onJump={onJump} />
  const { data, model, inference } = handoff
  const decision = inference.decision
  const type = choicesOf(problem, 'action.decision').find(
    (choice) => choice.value === decision?.type,
  )
  const fields = type?.fields ?? []
  const role = groupRole(splits, data.split)
  return (
    <Card title="後ろの段階に渡す値">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析 (ML-Fathom)</dt>
          <dd className="flex flex-col gap-1">
            <span>
              目的の列 <Code>{data.target ?? ''}</Code>,{' '}
              {shortLabel(choicesOf(problem, `${PART}.task`), data.task ?? '')}, 分割は
              {data.split ? shortLabel(splits, data.split) : ''}
            </span>
            {data.group_column && (
              <span>
                相手をまとめる列 <Code>{data.group_column}</Code>
                {role && ` (${role})`}
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
          <dd className="flex flex-col gap-1">
            <ModelExample problem={problem} />
            <span>
              出力の大きさ{' '}
              {model.outputs ?? 'クラスの数 (確率にする前の値を出す. softmax は付けない)'}.
              入力の形は書き出したデータセットから決まる (表と時系列は学習に使う列の数, 画像, 文,
              点群の列は 1 件の配列の形)
            </span>
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <EnvRow problem={problem} onJump={onJump} />
        <PolicyRow problem={problem} />
        <ProjectRow problem={problem} />
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
