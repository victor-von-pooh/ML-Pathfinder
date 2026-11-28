import type { Choice, Decision, Problem } from '../../api/types'
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

/** 学習・評価の段階に渡す, 監視する指標と向き (その他の指標は記録の頼み) */
function TrainingRow({ problem }: { problem: Problem }) {
  const training = problem.handoff?.training
  // 既製のモデルをそのまま使うと学習しない (監視する指標が無い)
  if (!training || training.monitor === null) return null
  const metric = problem.questions.find((q) => q.id === `${PART}.evaluation.metric`)
  const other = metric?.value === 'other'
  // 指標の名前を言葉でも添える (選択肢の説明の括弧の前まで. その他は書いた名前なので添えない).
  // 同じ値 (loss など) でも受け持ちごとに説明が違うので, 今の答えに合う選択肢 (ML-Quest の
  // choices_of が絞ったもの) から, 問いが要り, 答えが渡す指標と同じときだけ探す
  const words =
    other || !metric?.applies || metric.value !== training.metric
      ? null
      : (metric.choices.find((choice) => choice.value === training.metric)?.label.split(' (')[0] ??
        null)
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習・評価</dt>
      <dd className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-1">
          監視する指標 <Code>{training.monitor}</Code>
          {words && ` (${words})`}
        </span>
        {training.mode !== null && (
          <span className="flex flex-wrap items-center gap-1">
            監視の向き <Code>{training.mode}</Code> ({training.mode === 'max' ? '大きい' : '小さい'}
            ほど良い)
          </span>
        )}
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
 * モデルの作成・選定の雛形 (受け持ちに合う ML-ModelControl の同梱の例の名前). 無ければ理由を言葉で出す
 * (雛形は学習前の定義なので, 一から学習するときだけ渡る)
 */
function ModelExample({ problem }: { problem: Problem }) {
  const handoff = problem.handoff
  if (!handoff) return null
  const example = handoff.model.example
  if (example)
    return (
      <span className="flex flex-wrap items-center gap-1">
        モデルの作成・選定の雛形: <Code>{example}</Code> (モデルの作成・選定の段階で開ける例)
      </span>
    )
  return (
    <span>
      モデルの作成・選定の雛形:{' '}
      <span className="text-ink-3">
        {handoff.part.method === 'scratch'
          ? '受け持ちに合う雛形はありません (モデルの作成・選定の段階で定義を選ぶ)'
          : '一から学習しないので, 合う雛形はありません'}
      </span>
    </span>
  )
}

/**
 * 既製のモデルをそのまま使う予測の推論の欄 (出どころ, モデル, 重み, hash). 似た写真を探す
 * (並べるで既製のモデル) は, 検索の判断 (返す件数) と評価の正解の出どころも添える
 */
function ReadyRow({ problem }: { problem: Problem }) {
  const ready = problem.handoff?.inference.ready
  const decision = problem.handoff?.inference.decision
  if (!ready) return null
  // 判断の言葉は問いの選択肢から (引けなければ型の名前のまま). 待ち時間の上限は問いの答えから
  // (受け渡しの判断は件数だけで, 上限は骨組みの config で一式に渡すため)
  const search = decision?.type === 'search'
  // 既製の埋め込みの群分け (まとめるで既製のモデル) は, 群の数と数え方を問いの答えから読む
  // (受け渡しの group は空. 骨組みが問題の設定の答えを config に書くため)
  const groupK = problem.questions.find((q) => q.id === `${PART}.group.k`)
  const stabilityQuestion = problem.questions.find((q) => q.id === `${PART}.group.stability`)
  // 型の決まりは ML-Quest の skeleton_type だけが持つ
  const readyGroup = problem.skeleton_type === 'group_ready'
  const stabilityLabel =
    stabilityQuestion?.applies && typeof stabilityQuestion.value === 'string'
      ? (stabilityQuestion.choices.find((choice) => choice.value === stabilityQuestion.value)
          ?.label ?? null)
      : null
  const searchLabel =
    choicesOf(problem, 'action.decision')
      .find((choice) => choice.value === 'search')
      ?.label.split(' (')[0] ?? 'search'
  const answered = problem.questions.find((q) => q.id === 'action.decision')?.value
  const limit =
    answered && typeof answered === 'object' && !Array.isArray(answered)
      ? (answered as Record<string, unknown>).max_latency_ms
      : undefined
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
      <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
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
            一式を作ると求めた hash が出るので, 問題に書くと次から固定できます
          </span>
        )}
        {readyGroup && (
          <>
            <span>
              まとめ方:{' '}
              {groupK?.applies &&
              Number.isFinite(Number(groupK.value)) &&
              groupK.value !== null &&
              groupK.value !== ''
                ? `写真を既製のモデルの埋め込みで ${Number(groupK.value)} つの群に分ける`
                : '群の数はまだ答えていません'}
              {stabilityLabel && ` (群の安定性: ${stabilityLabel})`}
            </span>
            <span className="text-xs text-ink-2">
              写真を既製のモデルの埋め込みにし, k-means で群に分けて, 群の安定性と群の要約
              (写真の幅と高さ) を残してから推論の一式を作ります.
              写真を縮めた画素をそのまま分けた群と比べます
            </span>
          </>
        )}
        {search && (
          <>
            <span className="flex flex-wrap items-center gap-1">
              意思決定: {searchLabel}
              <Code>{`返す件数: ${String(decision.k)}`}</Code>
              {typeof limit === 'number' && (
                <Code>{`待ち時間の上限: ${String(limit)} ms (守る指標)`}</Code>
              )}
            </span>
            <span className="text-xs text-ink-2">
              写真を既製のモデルの埋め込みにし, 問いの写真に余弦の近さで近い写真を, 登録した写真
              (索引) から上位 {String(decision.k)} 件返します. 写真が &lt;種類&gt;/&lt;写真&gt;
              の形なら種類を評価の正解に使い (Recall@K と NDCG@K),
              そうでなければ評価は近さと見本だけです
            </span>
          </>
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

/**
 * 並べ方 (並べるで学習するときだけ). 利用者ごとに上位何件を並べるかと, 反応の表の列の役割を
 * 問いの言葉で出す (列の名前だけでは, どの列を何に使うかが分からないため)
 */
function RankRow({ problem }: { problem: Problem }) {
  const rank = problem.handoff?.rank
  if (!rank) return null
  const rows: [string, string | null, string][] = [
    ['利用者の列', rank.user, '利用者ごとに品物を並べる'],
    ['品物の列', rank.item, '並べる品物'],
    ['反応の時刻の列', rank.time, '古い反応で学び, 新しい反応で確かめる'],
    ['反応の強さの列', rank.reaction, '0 より大きい行だけを反応とみなす'],
  ]
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">並べ方 (データの分析, 学習, 評価)</dt>
      <dd className="flex flex-col gap-1">
        <span>
          {rank.k !== null
            ? `利用者ごとに上位 ${rank.k} 件を並べる (並べる件数 K. Recall@K と NDCG もこの K で数える)`
            : '並べる件数 (K) はまだ答えていません'}
        </span>
        {rows.map(([name, value, role]) =>
          value ? (
            <span key={name} className="flex flex-wrap items-center gap-1">
              {name} <Code>{value}</Code> ({role})
            </span>
          ) : name === '反応の強さの列' ? (
            <span key={name}>
              {name}: <span className="text-ink-3">無し (全ての行を反応とみなす)</span>
            </span>
          ) : null,
        )}
      </dd>
    </div>
  )
}

/**
 * まとめ方 (まとめるで学習するときだけ). 群の数, 群を作る列, 行を見分ける列と, 群の安定性の
 * 数え方を問いの言葉で出し, 評価が群の安定性と群の要約であることを添える (正解が無いので,
 * 当たり具合でなく群のまとまりと作り直しての一致で見るため)
 */
function GroupRow({ problem }: { problem: Problem }) {
  const group = problem.handoff?.group
  if (!group) return null
  // 数え方は今の答えに合う選択肢の言葉で出す (問いが要るときだけ. 引けなければ答えていない扱い)
  const question = problem.questions.find((q) => q.id === `${PART}.group.stability`)
  const stability =
    question?.applies && group.stability
      ? (question.choices.find((choice) => choice.value === group.stability)?.label ?? null)
      : null
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">まとめ方 (データの分析, 学習, 評価)</dt>
      <dd className="flex flex-col gap-1">
        <span>
          {group.k !== null
            ? `${group.k} つの群に分ける (群の数. 学習・評価の段階で群の数を変えた実験どうしで, 群のまとまりと安定性を比べられる)`
            : '群の数はまだ答えていません'}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          群を作る列 <Names names={group.columns} /> (数の列は標準化し, 他の列は値ごとに 0 と 1
          の列にして使う)
        </span>
        {group.id ? (
          <span className="flex flex-wrap items-center gap-1">
            行を見分ける列 <Code>{group.id}</Code> (群の割り当ての表に書く. 群を作るのには使わない)
          </span>
        ) : (
          <span>
            行を見分ける列:{' '}
            <span className="text-ink-3">無し (群の割り当ての表には行の番号を書く)</span>
          </span>
        )}
        <span>
          群の安定性の数え方: {stability ?? <span className="text-ink-3">まだ答えていません</span>}
        </span>
        <span className="text-xs text-ink-2">
          {
            '評価は群の安定性 (作り直した群と元の群の一致) と群の要約 (群ごとの行の数, 割合と列の平均か最も多い値) で見ます. '
          }
          正解が無いので当たり具合は問わず, 列をそのまま群に分けたものと比べます
        </span>
      </dd>
    </div>
  )
}

/**
 * 推論の段階のたどり直しで数える守る指標 (列の予測で名前を答えたときだけ). 数える量は
 * 名前でなく選択肢の言葉 (説明) で出す (名前だけでは何を数えるか分からないため)
 */
function GuardRow({ problem }: { problem: Problem }) {
  const guard = problem.handoff?.inference.guard
  if (!guard) return null
  const question = problem.questions.find((q) => q.id === 'issue.guard.counted')
  // 今の意思決定の型に合う選択肢 (ML-Quest が絞ったもの) から, 問いが要るときだけ探す
  const label = (value: string | null | undefined) =>
    question?.applies && value
      ? (question.choices.find((choice) => choice.value === value)?.label ?? null)
      : null
  const counted = guard.counted ? (label(guard.counted) ?? guard.counted) : null
  // 指さないと答えたときは, その言葉 (課題の場で数える) を出す
  const none = !guard.counted && question?.value === 'none' ? label('none') : null
  const better =
    guard.better === 'lower'
      ? '小さいほど良い'
      : guard.better === 'higher'
        ? '大きいほど良い'
        : null
  return (
    <span className="flex flex-col gap-1">
      <span>
        守る指標: {guard.name}
        {better && ` (${better})`}
        {guard.line !== null && `. 守る線は ${guard.line}${guard.unit ? ` (${guard.unit})` : ''}`}
      </span>
      {counted ? (
        <span>たどり直しで数える量: {counted}</span>
      ) : (
        none && <span>たどり直しで数える量: {none}</span>
      )}
    </span>
  )
}

/** 要る機能の名前 (ML-Quest の FEATURES の見出し. 入れ方は画面の上のカード) */
function RequiresRow({ problem }: { problem: Problem }) {
  const names = problem.handoff?.requires ?? []
  if (!names.length) return null
  const labels = new Map(problem.requires.map((item) => [item.name, item.label]))
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習・評価の段階に要る機能</dt>
      <dd className="flex flex-col gap-1">
        <span>{names.map((name) => labels.get(name) ?? name).join(', ')}</span>
        <span className="text-xs text-ink-2">
          入れ方は画面の上の「学習・評価の段階の準備」に出ます
        </span>
      </dd>
    </div>
  )
}

/**
 * 書き出した学習のプロジェクト. データの分析の書き出し先, モデルの定義の置き場, 学習の
 * プロジェクトは, 後ろの段階がこの記録から写さずに使う
 */
function ProjectRow({ problem }: { problem: Problem }) {
  const project = problem.project
  if (!project?.path) return null
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-ink-2">学習のプロジェクト (書き出した場所)</dt>
      <dd className="flex flex-col gap-1">
        <span>
          場所 <Code>{project.path}</Code>
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
          データの分析, モデルの作成・選定, 学習・評価の段階はこの場所を使います
          (書き出し直すと記録を書き換える)
        </span>
      </dd>
    </div>
  )
}

/**
 * 列の予測でない受け持ちの値 (目的の列と意思決定は渡さない. ファイルの組は分割とグループ, 画像と表の
 * 生成は分割, 並べるは分割と反応の時刻の列と並べ方, まとめるは分割とまとめ方を渡す)
 */
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
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
          <dd className="flex flex-col gap-1">
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
            {data.split && (
              <span>
                分割は{shortLabel(splits, data.split)}
                {handoff.rank && data.time_column && (
                  <>
                    {' '}
                    (反応の時刻の列 <Code>{data.time_column}</Code> の順)
                  </>
                )}
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
              データの分析で書き戻した分割とグループを, 画像と表の生成とまとめるは分割を,
              並べるは分割と反応の時刻の列を渡します
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
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
        <RankRow problem={problem} />
        <GroupRow problem={problem} />
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <EnvRow problem={problem} onJump={onJump} />
        <PolicyRow problem={problem} />
        <ProjectRow problem={problem} />
        {handoff.inference.ready ? (
          <ReadyRow problem={problem} />
        ) : (
          <div>
            <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
            <dd className="flex flex-col gap-1">
              <span>意思決定の材料は作りません (列の予測だけ)</span>
              {handoff.rank && (
                <span>
                  学習の後に, 推論に使う一式を実験の inference/ に作ります. 作れない定義のときは,
                  その理由を train.log に書きます
                </span>
              )}
              {handoff.group && (
                <>
                  <span>
                    推論の一式は作りません. 実験に学習した重み, 行ごとの群の割り当て,
                    列の符号化と群の中心が残り, その実験で新しい行を群に割り当てられます
                  </span>
                  <span className="text-xs text-ink-2">
                    まとめるでは守る指標を問いません (群は人が解釈して使い,
                    使われたかは運用の後に見るため)
                  </span>
                </>
              )}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  )
}

/**
 * 異常の検知の値 (受け渡しの anomaly があるときだけ). 列の予測の欄と分け, 度合いの決め方, 件数の
 * 上限と K, 正解の有る無しで変わる評価と, 件数の上限で回す振り分けを言葉で出す (度合いは確率で
 * ないので, 列の予測の振り分けと回し方が違うため)
 */
function AnomalyHandoff({ problem, splits }: { problem: Problem; splits: Choice[] }) {
  const handoff = problem.handoff
  const anomaly = handoff?.anomaly
  if (!handoff || !anomaly) return null
  const { data, model, inference } = handoff
  // 度合いの決め方は今の答えに合う選択肢の言葉 (問いが要るときだけ. 引けなければ値のまま)
  const question = problem.questions.find((q) => q.id === `${PART}.anomaly.score`)
  const score =
    question?.applies && anomaly.score
      ? (question.choices.find((choice) => choice.value === anomaly.score)?.label.split(' (')[0] ??
        anomaly.score)
      : anomaly.score
  const distance = anomaly.score === 'distance'
  const labeled = anomaly.label !== null
  const decision = inference.decision
  // 型の名前は今の答えに合う選択肢から引き, 引けなければ振り分けの言葉 (異常の検知では 7 の型の
  // 問いが出ず, ML-Quest が選択肢を列の予測の型に絞ると振り分けが無いため)
  const triage = choicesOf(problem, 'action.decision').find((choice) => choice.value === 'triage')
  const triageName = triage?.label.split(' (')[0] ?? '振り分ける'
  return (
    <Card title="後ろの段階に渡す値">
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">機械学習の受け持ち</dt>
          <dd className="flex flex-col gap-1">
            <span>受け持ち: {partLabel(problem, 'role', handoff.part.role)}</span>
            <span>正解の種類: {partLabel(problem, 'target.kind', handoff.part.target_kind)}</span>
            <span>
              正解の出どころ: {partLabel(problem, 'target.source', handoff.part.target_source)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
          <dd className="flex flex-col gap-1">
            {labeled ? (
              <span className="flex flex-wrap items-center gap-1">
                異常の正解の列 <Code>{anomaly.label ?? ''}</Code> (正解の欠けた行は正常と見なす)
              </span>
            ) : (
              <span>
                異常の正解の列: <span className="text-ink-3">無し (全ての行を正常と見なす)</span>
              </span>
            )}
            {anomaly.id ? (
              <span className="flex flex-wrap items-center gap-1">
                行の id の列 <Code>{anomaly.id}</Code> (人が確かめた結果の記録が 1 行を指す.
                度合いには使わない)
              </span>
            ) : (
              <span>
                行の id の列: <span className="text-ink-3">無し (行の位置で指す)</span>
              </span>
            )}
            {data.split && (
              <span>分割は{shortLabel(splits, data.split)} (学習用は正常の行だけ)</span>
            )}
            <span className="flex flex-wrap items-center gap-1">
              度合いに使う列 <Names names={anomaly.columns} />
            </span>
            <span className="flex flex-wrap items-center gap-1">
              除く列 <Names names={data.drop} />
            </span>
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            異常の度合い (データの分析, 学習, 評価)
          </dt>
          <dd className="flex flex-col gap-1">
            <span>
              度合いの決め方: {score ?? <span className="text-ink-3">まだ答えていません</span>}{' '}
              (大きいほど異常)
            </span>
            <span>
              {anomaly.capacity !== null
                ? `人が 1 回に確かめる件数の上限は ${anomaly.capacity} 件 (守る指標)`
                : '人が 1 回に確かめる件数の上限はまだ答えていません'}
              {anomaly.k !== null && `. 評価の上位 K 件の K は ${anomaly.k}`}
            </span>
            {distance && (
              <span className="text-xs text-ink-2">
                距離は学習用の正常の行の中心と散らばりを数えるだけで, 学習の繰り返しはありません
              </span>
            )}
            <span className="text-xs text-ink-2">
              {labeled
                ? '評価は, 異常の行のある分割で上位 K 件の適合率と PR-AUC を数えます (異常の割合が小さいと, 上位 K 件の適合率は低く出ます)'
                : '正解が無いので当たり具合は数えず, 評価は度合いの分布と上位 K 行の要約 (行の id, 度合い, 最も外れた列) で見ます'}
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
          <dd className="flex flex-col gap-1">
            {distance ? (
              'モデルは作りません (距離に基づく度合いは学習しないため)'
            ) : (
              <>
                <ModelExample problem={problem} />
                {model.outputs !== null && (
                  <span>
                    出力の大きさ {model.outputs} (度合いに使う列の数. 入力と同じ幅の再構成を出す)
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <ProjectRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
          <dd className="flex flex-col gap-1">
            {decision && (
              <span className="flex flex-wrap items-center gap-1">
                意思決定: {triageName}
                {decision.capacity !== undefined && (
                  <Code>{`件数の上限: ${String(decision.capacity)}`}</Code>
                )}
              </span>
            )}
            <span>
              度合いの高い順に, 件数の上限まで人の確かめに回します (確率としきい値でなく,
              件数の上限で回す)
            </span>
            <span>
              学習の後に, 異常の度合いの一式を実験の inference/ に作ります
              {!distance && ' (仮のモデルでは作らない)'}
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  )
}

/**
 * 効果の見積もりの値 (受け渡しの uplift があるときだけ). 列の予測の欄と分け, 処置と結果の列,
 * 効果の意味, 上位 K 割の K と配る数の上限, 群の差で数える評価と, 配る数の上限で配る判断を
 * 言葉で出す (顧客ごとの正解の効果は見えず, 当たり具合を行ごとに数える型と違うため)
 */
function UpliftHandoff({ problem, splits }: { problem: Problem; splits: Choice[] }) {
  const handoff = problem.handoff
  const uplift = handoff?.uplift
  if (!handoff || !uplift) return null
  const { part, data, model, inference } = handoff
  // 結果の種類は今の答えに合う選択肢の言葉 (問いが要るときだけ. 引けなければ値のまま)
  const question = problem.questions.find((q) => q.id === `${PART}.uplift.outcome_kind`)
  const kind =
    question?.applies && uplift.outcome_kind
      ? shortLabel(question.choices, uplift.outcome_kind)
      : uplift.outcome_kind
  const amount = uplift.outcome_kind === 'amount'
  const decision = inference.decision
  const treat = choicesOf(problem, 'action.decision').find((choice) => choice.value === 'treat')
  const budget = treat?.fields?.find((field) => field.key === 'budget')
  const budgetName = budget?.label.split(' (')[0] ?? '配る数の上限'
  const rows: [string, string | null][] = [
    ['受け持ち', partLabel(problem, 'role', part.role)],
    ['出力の形', partLabel(problem, 'output', part.output)],
    ['正解の出どころ', partLabel(problem, 'target.source', part.target_source)],
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
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
          <dd className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1">
              処置の列 <Code>{uplift.treatment ?? ''}</Code> (配ったら 1, 配らなければ 0.
              無作為に配った記録を前提にする. 見積もりには使わない)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              結果の列 <Code>{uplift.outcome ?? ''}</Code>
              {kind && ` (${kind})`}
            </span>
            {uplift.id ? (
              <span className="flex flex-wrap items-center gap-1">
                行の id の列 <Code>{uplift.id}</Code> (行ごとの効果と配る判断が 1 行を指す.
                見積もりには使わない)
              </span>
            ) : (
              <span>
                行の id の列: <span className="text-ink-3">無し (行の位置で指す)</span>
              </span>
            )}
            {data.split && (
              <span>
                分割は{shortLabel(splits, data.split)} (処置で層を作り,
                全ての分割に処置の群と対照の群 (配らなかった行) が入る)
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1">
              見積もりに使う列 <Names names={uplift.columns} />
            </span>
            <span className="flex flex-wrap items-center gap-1">
              除く列 <Names names={data.drop} />
            </span>
            {data.unlabeled === 'drop' && <span>結果の欠けた行は落とす</span>}
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            効果の見積もり (データの分析, 学習, 評価)
          </dt>
          <dd className="flex flex-col gap-1">
            <span>
              効果は, 処置したときの結果 − しないときの結果 (
              {uplift.outcome_kind === null
                ? '結果の種類はまだ答えていません'
                : amount
                  ? '値の差'
                  : '確率の差'}
              )
            </span>
            <span>
              {uplift.k !== null
                ? `評価の上位 K 割の K (効果の見積もりの高い順に上位の何割を見るか) は ${uplift.k}`
                : '評価の上位 K 割の K (効果の見積もりの高い順に上位の何割を見るか) はまだ答えていません'}
              {decision?.budget !== undefined &&
                `. ${budgetName}は ${String(decision.budget)} (守る指標)`}
            </span>
            <span className="text-xs text-ink-2">
              顧客ごとの正解の効果は見えないので, 評価は効果の見積もりの高い順に, Qini の曲線と Qini
              の係数 (効果の大きい順に配ったときに, でたらめに配るよりどれだけ良いか), 上位 K
              割の効果の差 (処置の群と対照の群の結果の平均の差) で数えます
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
          <dd className="flex flex-col gap-1">
            <ModelExample problem={problem} />
            <span>
              出力は処置したときの予測 treated としないときの予測 control の 2 つ
              {model.outputs !== null && ` (それぞれの大きさ ${model.outputs})`}.
              処置の列は入力に入れない
            </span>
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <ProjectRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
          <dd className="flex flex-col gap-1">
            {decision ? (
              <span className="flex flex-wrap items-center gap-1">
                意思決定: {treat?.label.split(' (')[0] ?? decision.type}
                {decision.budget !== undefined && (
                  <Code>{`${budgetName}: ${String(decision.budget)}`}</Code>
                )}
              </span>
            ) : (
              <span>
                意思決定: <span className="text-ink-3">まだ決めていません</span>
              </span>
            )}
            <span>
              効果の高い順に, {budgetName}まで配ります (確率としきい値でなく, 数の上限で配る)
            </span>
            <span>
              学習の後に, 推論の段階が読む効果の決め方 (uplift_estimator.json) と行ごとの効果
              (uplift_effects.csv) を実験に残します
            </span>
            <span className="text-xs text-ink-2">
              効果は無作為に配った記録からの見積もりです. 配った効果は,
              配る相手を無作為に分けて試して確かめます
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  )
}

/** 今の値段に対する変える割合の言葉 (0.05 は +5 %) */
function ratioText(ratio: number): string {
  const percent = Math.round(ratio * 1000) / 10
  return `${percent > 0 ? '+' : ''}${percent} %`
}

/** 変える割合の絶対値の言葉 (0.1 は 10 %. 向きの符号を付けない) */
function limitText(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10} %`
}

/**
 * 値段を変える判断の値 (受け渡しの price があるときだけ). 列の予測と効果の見積もりの欄と分け,
 * 値段, 売れた数, 原価の列, 今の値段の決め方, 値段の候補と変える幅の上限, 誤差と弾力性と利益の
 * 比べで数える評価と, 利益が最も大きい値段を選ぶ判断を言葉で出す (配る判断の型と違う言葉のため)
 */
function PriceHandoff({ problem, splits }: { problem: Problem; splits: Choice[] }) {
  const handoff = problem.handoff
  const price = handoff?.price
  if (!handoff || !price) return null
  const { part, data, model, inference } = handoff
  const decision = inference.decision
  const choice = choicesOf(problem, 'action.decision').find((item) => item.value === 'price')
  // 欄の名前は ML-Quest の欄の言葉の括弧の前まで (引けなければ ML-Quest の名前と同じ言葉)
  const nameOf = (key: string, fallback: string) =>
    choice?.fields?.find((field) => field.key === key)?.label.split(' (')[0] ?? fallback
  const candidatesName = nameOf('candidates', '値段の候補')
  const maxName = nameOf('max_change', '値段を変える幅の上限')
  const candidates = Array.isArray(decision?.candidates) ? decision.candidates : null
  const max = typeof decision?.max_change === 'number' ? decision.max_change : null
  const rows: [string, string | null][] = [
    ['受け持ち', partLabel(problem, 'role', part.role)],
    ['出力の形', partLabel(problem, 'output', part.output)],
    ['正解の出どころ', partLabel(problem, 'target.source', part.target_source)],
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
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
          <dd className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1">
              値段の列 <Code>{price.price ?? ''}</Code> (売ったときの値段. 試しに値段を変えた記録
              (無作為に近い) を前提にする. 売れ行きの予測の入力の最後の列)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              売れた数の列 <Code>{price.units ?? ''}</Code> (その値段で売れた数. 予測する値)
            </span>
            {price.cost ? (
              <span className="flex flex-wrap items-center gap-1">
                原価の列 <Code>{price.cost}</Code> (商品 1 つを仕入れるか作るのにかかる値段.
                予測には使わない)
              </span>
            ) : (
              <span>
                原価の列: <span className="text-ink-3">無し (原価を 0 とし, 売上で選ぶ)</span>
              </span>
            )}
            {price.product ? (
              <span className="flex flex-wrap items-center gap-1">
                商品の id の列 <Code>{price.product}</Code> (値段を選ぶ単位. 予測には使わない)
              </span>
            ) : (
              <span>
                商品の id の列: <span className="text-ink-3">無し (行ごとに値段を選ぶ)</span>
              </span>
            )}
            {price.id ? (
              <span className="flex flex-wrap items-center gap-1">
                行の id の列 <Code>{price.id}</Code> (記録の 1 行を指す. 予測には使わない)
              </span>
            ) : (
              <span>
                行の id の列: <span className="text-ink-3">無し (行の位置で指す)</span>
              </span>
            )}
            {data.split && (
              <span>
                分割は{shortLabel(splits, data.split)} (値段の段 (値段の高さで行を分けた組)
                で層を作る)
              </span>
            )}
            <span className="flex flex-wrap items-center gap-1">
              予測に使う列 <Names names={price.columns} />
              (値段の列は最後に足す)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              除く列 <Names names={data.drop} />
            </span>
            {data.unlabeled === 'drop' && <span>売れた数の欠けた行は落とす</span>}
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            値段の選び方 (データの分析, 学習, 評価)
          </dt>
          <dd className="flex flex-col gap-1">
            <span>
              今の値段は,{' '}
              {price.product
                ? '商品ごとの記録の値段の中央値 (試しに上げ下げした値段の真ん中)'
                : 'その行の記録の値段'}
            </span>
            <span>
              {candidates
                ? `${candidatesName} (今の値段に対する変える割合. 候補の値段は今の値段 × (1 + 割合)) は ${candidates.map(ratioText).join(', ')}`
                : `${candidatesName} (今の値段に対する変える割合) はまだ決めていません`}
            </span>
            <span>
              {max !== null
                ? `${maxName} (変える割合の絶対値. 守る指標. 上限を超える候補は選ばない) は ${limitText(max)}`
                : `${maxName} (変える割合の絶対値. 守る指標) はまだ決めていません`}
            </span>
            <span>
              利益は (値段 − 原価) × 予測した売れた数. 商品ごとに,
              候補の中で利益が最も大きい値段を選ぶ
            </span>
            <span className="text-xs text-ink-2">
              評価は, 記録の値段での売れた数の誤差, 弾力性 (値段を 1 % 上げたときに売れた数が何 %
              変わるか. 負なら値上げで売れる数が減る),
              選んだ値段と今の値段での見込みの利益の比べで数えます
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
          <dd className="flex flex-col gap-1">
            <ModelExample problem={problem} />
            <span>
              入力の最後の列が値段で, 出力は売れた数の予測 units
              {model.outputs !== null && ` (大きさ ${model.outputs})`}.
              値段の列を候補の値段に置き換えて, 候補ごとの売れた数を予測する
            </span>
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <ProjectRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
          <dd className="flex flex-col gap-1">
            {decision ? (
              <span className="flex flex-wrap items-center gap-1">
                意思決定: {choice?.label.split(' (')[0] ?? decision.type}
                {candidates && (
                  <Code>{`${candidatesName}: ${candidates.map(ratioText).join(', ')}`}</Code>
                )}
                {max !== null && <Code>{`${maxName}: ${limitText(max)}`}</Code>}
              </span>
            ) : (
              <span>
                意思決定: <span className="text-ink-3">まだ決めていません</span>
              </span>
            )}
            <span>
              商品ごとに, {maxName}を超えない候補の中で利益が最も大きい値段を選びます
              (今の値段も候補なので, 見込みの利益は今の値段より小さくならない)
            </span>
            <span>
              学習の後に, 推論の段階が読む値段の決め方 (price_estimator.json) と商品ごとの選んだ値段
              (price_choices.csv) を実験に残し, 値段の推論の一式を実験の inference/ に作ります
              (仮のモデルでは作らない)
            </span>
            <span className="text-xs text-ink-2">
              選ぶ値段は試しに値段を変えた記録からの見積もりです. 値段を変えた効き目は,
              値段を試して確かめます
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  )
}

/** 分位点の水準の言葉 (小数の 3 桁まで. 1/3 のような水準を短く出す) */
function levelText(level: number): string {
  return String(Number(level.toFixed(3)))
}

/**
 * 発注に使う水準 τ = 品切れの損 / (品切れの損 + 売れ残りの損) (ML-Quest の docs/DESIGN.md の
 * 5 節の発注の判断の式. 出すだけで, 学ぶ水準と発注の数は ML-Quest と ML-Inference が決める).
 * 2 つの損が有限の正の数でなければ null
 */
function orderLevel(decision: Decision | null): number | null {
  if (decision?.type !== 'order') return null
  const shortage = decision.shortage_cost
  const holding = decision.holding_cost
  if (typeof shortage !== 'number' || typeof holding !== 'number') return null
  if (!Number.isFinite(shortage) || !Number.isFinite(holding) || shortage <= 0 || holding <= 0)
    return null
  return shortage / (shortage + holding)
}

/**
 * 時間をまたぐ量の判断の値 (受け渡しの demand があるときだけ). 列の予測の欄と分け, 商品の id,
 * 日付, 売れた数, 在庫の数の列, 先の期間の日数と学ぶ水準, 損の比から決まる水準 τ, 分位点の誤差と
 * 損失と発注の数の損の比べで数える評価と, 発注の判断を言葉で出す (列の予測の量を決める型と違う
 * 言葉のため)
 */
function DemandHandoff({ problem, splits }: { problem: Problem; splits: Choice[] }) {
  const handoff = problem.handoff
  const demand = handoff?.demand
  if (!handoff || !demand) return null
  const { part, data, model, inference } = handoff
  const decision = inference.decision?.type === 'order' ? inference.decision : null
  const choice = choicesOf(problem, 'action.decision').find((item) => item.value === 'order')
  // 欄の名前は ML-Quest の欄の言葉の括弧の前まで (引けなければ ML-Quest の名前と同じ言葉)
  const nameOf = (key: string, fallback: string) =>
    choice?.fields?.find((field) => field.key === key)?.label.split(' (')[0] ?? fallback
  const shortageName = nameOf('shortage_cost', '品切れの損')
  const holdingName = nameOf('holding_cost', '売れ残りの損')
  const maxName = nameOf('max_order', '発注の数の上限')
  const tau = orderLevel(decision)
  const values: [string, unknown][] = decision
    ? [
        [shortageName, decision.shortage_cost],
        [holdingName, decision.holding_cost],
        [maxName, decision.max_order],
      ]
    : []
  const rows: [string, string | null][] = [
    ['受け持ち', partLabel(problem, 'role', part.role)],
    ['出力の形', partLabel(problem, 'output', part.output)],
    ['正解の出どころ', partLabel(problem, 'target.source', part.target_source)],
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
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
          <dd className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1">
              商品の id の列 <Code>{demand.product ?? ''}</Code> (発注の数を決める単位.
              予測には使わない)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              日付の列 <Code>{demand.date ?? ''}</Code> (日ごと. 曜日はデータの分析で列にする)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              日ごとの売れた数の列 <Code>{demand.units ?? ''}</Code> (先の期間の合計が予測する値.
              過去の売れた数はずらした列にして予測に使う)
            </span>
            {demand.stock ? (
              <span className="flex flex-wrap items-center gap-1">
                在庫の数の列 <Code>{demand.stock}</Code> (その日の始めの在庫. 発注の数から引く.
                予測には使わない)
              </span>
            ) : (
              <span>
                在庫の数の列: <span className="text-ink-3">無し (在庫を 0 として発注する)</span>
              </span>
            )}
            {demand.id ? (
              <span className="flex flex-wrap items-center gap-1">
                行の id の列 <Code>{demand.id}</Code> (記録の 1 行を指す. 予測には使わない)
              </span>
            ) : (
              <span>
                行の id の列: <span className="text-ink-3">無し (行の位置で指す)</span>
              </span>
            )}
            {data.split && (
              <span>分割は{shortLabel(splits, data.split)} (発注を決める日の順に分ける)</span>
            )}
            <span className="flex flex-wrap items-center gap-1">
              予測に使う商品の特徴の列 <Names names={demand.columns} />
              (過去の売れた数と曜日の列はデータの分析で足す)
            </span>
            <span className="flex flex-wrap items-center gap-1">
              除く列 <Names names={data.drop} />
            </span>
            {data.unlabeled === 'drop' && (
              <span>先の期間の合計が分からない行 (記録の終わりの近く) は学習と評価に使わない</span>
            )}
            {data.source ? (
              <span>
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            ) : (
              <span className="text-ink-3">データは入れていません</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">
            発注の数の決め方 (データの分析, 学習, 評価)
          </dt>
          <dd className="flex flex-col gap-1">
            <span>
              商品と発注を決める日ごとに, 先の {demand.horizon} 日の需要 (売れる数の合計)
              を分位点で予測する
            </span>
            <span>
              学ぶ分位点の水準は {demand.levels.map(levelText).join(', ')} (
              {tau !== null ? '0.5 と発注に使う水準 τ を含む' : '0.5 を含む'}. 0.9 は 9
              割の場合でこれより少ない数)
            </span>
            <span>
              {tau !== null
                ? `発注に使う水準 τ (${shortageName} / (${shortageName} + ${holdingName})) は ${levelText(tau)}`
                : `発注に使う水準 τ (${shortageName} / (${shortageName} + ${holdingName})) は, 損を決めると出ます`}
            </span>
            <span>
              発注の数は, τ の分位点から在庫の数を引いた数の切り捨てと切り上げ (0 より下は 0)
              のうち見込みの損の小さい方 (同じなら少ない方) を, {maxName}で切ったもの. 2 つの損は,
              商品 1 つあたりの同じお金の単位で書く
            </span>
            <span className="text-xs text-ink-2">
              評価は, 0.5 の分位点の誤差, 分位点の損失と, 実際の需要での発注の数の損
              (前の期間と同じ数を発注した損との比べ) で数えます
            </span>
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
          <dd className="flex flex-col gap-1">
            <ModelExample problem={problem} />
            <span>
              入力は行 x (学習に使う列), 出力は水準の小さい順の分位点 quantiles
              {model.outputs !== null && ` (大きさ ${model.outputs}. 学ぶ水準の数)`}
            </span>
          </dd>
        </div>
        <TrainingRow problem={problem} />
        <RequiresRow problem={problem} />
        <ProjectRow problem={problem} />
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
          <dd className="flex flex-col gap-1">
            {decision ? (
              <span className="flex flex-wrap items-center gap-1">
                意思決定: {choice?.label.split(' (')[0] ?? decision.type}
                {values.map(([name, value]) => (
                  <Code key={name}>{`${name}: ${String(value)}`}</Code>
                ))}
                {tau !== null && <Code>{`水準 τ: ${levelText(tau)}`}</Code>}
              </span>
            ) : (
              <span>
                意思決定: <span className="text-ink-3">まだ決めていません</span>
              </span>
            )}
            <span>
              新しい日ごとの記録の商品ごとに, 最も遅い日を発注を決める日とし, 先の {demand.horizon}{' '}
              日の需要の τ の分位点から在庫を引いて, {maxName}の中で発注します
            </span>
            <span>
              学習の後に, 推論の段階が読む需要の決め方 (demand_estimator.json)
              と発注を決める日ごとの発注の数 (demand_orders.csv) を実験に残し,
              需要の推論の一式を実験の inference/ に作ります (仮のモデルでは作らない)
            </span>
            <span className="text-xs text-ink-2">
              発注の数は見積もりです. 品切れの日の売れた数は需要より少ないので,
              欠品で抑えられた過去の売れた数から学ぶと需要を少なめに見積もります.
              実際の損は発注の後の売れた数で確かめます
            </span>
          </dd>
        </div>
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
              ? '5 の「機械学習を使いますか」で使うと決めると, データの分析, モデルの作成・選定, 学習・評価, 推論の各段階で選ぶ値がここに出ます.'
              : `まだ渡せません. ${problem.handoff_error ?? ''}`}
        </p>
      </Card>
    )
  // 異常の検知は, タスクがあっても列の予測と別の欄
  if (handoff.anomaly) return <AnomalyHandoff problem={problem} splits={splits} />
  // 効果の見積もりも, タスクがあっても列の予測と別の欄
  if (handoff.uplift) return <UpliftHandoff problem={problem} splits={splits} />
  // 値段を変える判断も, タスクがあっても列の予測と別の欄
  if (handoff.price) return <PriceHandoff problem={problem} splits={splits} />
  // 時間をまたぐ量の判断も, タスクがあっても列の予測と別の欄
  if (handoff.demand) return <DemandHandoff problem={problem} splits={splits} />
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
          <dt className="mb-1 text-xs font-medium text-ink-2">データの分析</dt>
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
                データ <Code>{data.source.source}</Code> (データの分析から推論までのアプリも,
                写したこのファイルを同じ読み方で開く)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-medium text-ink-2">モデルの作成・選定</dt>
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
          <dt className="mb-1 text-xs font-medium text-ink-2">推論</dt>
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
            <GuardRow problem={problem} />
          </dd>
        </div>
      </dl>
    </Card>
  )
}
