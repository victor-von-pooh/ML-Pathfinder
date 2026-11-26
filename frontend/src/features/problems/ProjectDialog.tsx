import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderOutput } from 'lucide-react'
import { Fragment, useState } from 'react'

import { api, ApiError } from '../../api/client'
import type { Finding, Problem } from '../../api/types'
import { Dialog } from '../../components/Dialog'
import { PathField } from '../../components/PathPicker'
import { Button, ErrorBox } from '../../components/ui'

/** 問いの答え (受け渡しの値は直すところが残ると無いので, 問いの答えから読む) */
function answerOf(problem: Problem, id: string): string | null {
  const value = problem.questions.find((q) => q.id === id)?.value
  return typeof value === 'string' ? value : null
}

/** 実験の名前を省略したときの元 (ML-Quest の experiment_name と同じ) */
const DEFAULT_NAMES = {
  column: '目的の列とタスク',
  items: '正解の種類と受け持ち',
  generate: '正解の種類と受け持ち',
  table: '正解の種類と受け持ち',
  rank: '品物の列と受け持ち',
  group: '受け持ちと群の数',
  anomaly: '受け持ちと度合いの決め方',
  uplift: '結果の列と受け持ち',
  price: '売れた数の列と受け持ち',
  demand: '日ごとの売れた数の列と受け持ち',
  // 英字の後は空けて読む
  policy: '環境の登録名か env ',
  // 一式の名前は, 省略するとモデルと重みの名前から
  ready: 'モデルと重みの名前',
  search: 'モデルの名前と返す件数',
  group_ready: 'モデルの名前と群の数',
} as const

/** 損得と制約 (action.decision) に直すところが残るか (残れば推論の一式に意思決定の既定値を付けない) */
function decisionDropped(errors: Finding[]): boolean {
  return errors.some((f) => f.id === 'action.decision' || f.id.startsWith('action.decision.'))
}

/** 確かめの項目の場所の問いの題 (下の項目の場所は, 持つ問いの題) */
function questionTitle(problem: Problem, finding: Finding): string | null {
  const found = problem.questions.find(
    (q) => finding.id === q.id || finding.id.startsWith(`${q.id}.`),
  )
  return found ? `${found.section}. ${found.title}` : null
}

/** ML-Found のプロジェクトの骨組みを書き出す対話 */
export function ProjectDialog({ problem, onClose }: { problem: Problem; onClose: () => void }) {
  // 画像の領域と点群, 画像と表の生成, 並べる, まとめる, 異常の検知, 効果の見積もり, 値段を変える判断, 時間をまたぐ量の判断, 方策の, 列の予測と違う既定の名前と次にすること
  // 骨組みの型は ML-Quest の skeleton_type (書き出せるのは機械学習を使うときだけなので, 無いか知らない型なら列の予測)
  const given = problem.skeleton_type
  const type = given !== null && Object.hasOwn(DEFAULT_NAMES, given) ? given : 'column'
  // 異常の検知の度合いの決め方と正解の出どころ (次にすることの出し分け. 距離は学習しない)
  const distance = answerOf(problem, 'ml.parts.0.anomaly.score') === 'distance'
  const labeled = answerOf(problem, 'ml.parts.0.target.source') === 'few'
  // 方策の環境の登録名 (次にすることの環境の手順の出し分け)
  const envId = answerOf(problem, 'ml.parts.0.env_id')?.trim() || null
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  // 「それでも書き出す」は確かめた一覧の印で覚える (一覧が変われば確かめ直す)
  const errors = problem.open_errors
  const signature = errors.map((f) => `${f.id}\u0000${f.message}`).join('\u0001')
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const accepted = errors.length > 0 && confirmed === signature
  // 問題の設定の確かめの直すところが残ると推論の段階に渡す値を作れない (入れたデータの確かめ
  // だけなら作れるが, 直すまでつながない). ML-Quest の README の書き分けと同じ
  const checked = problem.handoff === null
  // ファイルの組, 画像と表の生成, 並べる, まとめる, 方策の一式は意思決定を持たないので, 損得と制約の
  // 注意は列の予測, 効果の見積もり (配る数の上限), 値段を変える判断 (値段の候補と変える幅の上限),
  // 時間をまたぐ量の判断 (発注の判断の損と上限) だけ
  const dropped =
    (type === 'column' || type === 'uplift' || type === 'price' || type === 'demand') &&
    decisionDropped(errors)
  const client = useQueryClient()
  const write = useMutation({
    // 書き出した時点の確かめ (読み直した一覧が変わっても, 次にすることはその時点のまま)
    mutationFn: (sent: { accept: boolean; dropped: boolean }) =>
      api.writeProject(problem.id, {
        path: path.trim(),
        name: name.trim() || undefined,
        overwrite,
        // 一覧を確かめたときだけ
        accept_errors: sent.accept || undefined,
      }),
    // 書き出した場所は問題の設定に保存されるので, 読み直して受け渡しの値に出す (読み直した
    // 印と同じなので, 他で変わった知らせは出ない)
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['problem', problem.id] })
    },
    // 画面の一覧に無い直すところが見つかった (409) ら, 読み直して一覧を出す
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: ['problem', problem.id] })
      }
    },
  })
  // 書き出した後の, データセットとモデルの定義の置き場 (方策の骨組みはモデルの定義だけを持つ)
  const project = write.data?.project
  const entries: [string, string | null | undefined][] = [
    ['データセット', project?.dataset],
    ['モデルの定義', project?.model_spec],
  ]
  const places = entries.filter((entry): entry is [string, string] => !!entry[1])
  return (
    <Dialog title="学習のプロジェクトを書き出す" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-2">
        {type === 'group_ready' ? (
          <>
            既製のモデルの埋め込みで写真を群に分け, 推論の一式を作る骨組み (config の bundle.yaml,
            bundle.py, README, problem.yaml の写し) を書き出します. 学習はしません. 書き出した
            README の「次にすること」の順に, 写真を置いて群と一式を作り, 登録します.
          </>
        ) : type === 'search' ? (
          <>
            既製のモデルの埋め込みで写真の索引を作り, 似た写真を探す推論の一式を作る骨組み (config
            の bundle.yaml, bundle.py, README, problem.yaml の写し) を書き出します. 学習はしません.
            書き出した README の「次にすること」の順に, 写真を置いて索引と一式を作り, 登録します.
          </>
        ) : type === 'ready' ? (
          <>
            既製のモデルの推論の一式を作る骨組み (config の bundle.yaml, bundle.py, README,
            problem.yaml の写し) を書き出します. 学習はしません. 書き出した README
            の「次にすること」の順に, 推論の一式を作って登録します.
          </>
        ) : (
          <>
            ML-Found のプロジェクトの骨組み (config, train.py, README, problem.yaml の写し
            {type === 'policy'
              ? ', 方策のモデルの model.py, 登録名が無ければ自作の環境の env.py'
              : ''}
            ) を書き出します. 書き出した README の「次にすること」の順に,{' '}
            {type === 'policy'
              ? '環境と守りを整えて方策を学習します.'
              : type === 'rank'
                ? '反応の表とモデルの定義を置いて学習します.'
                : type === 'group'
                  ? '群を作る表とモデルの定義を置いて学習します.'
                  : type === 'anomaly' && distance
                    ? '異常の検知の表を置いて度合いを数えます (学習はしません).'
                    : type === 'anomaly'
                      ? '異常の検知の表とモデルの定義を置いて学習します.'
                      : type === 'uplift'
                        ? '介入の記録の表とモデルの定義を置いて, 顧客ごとの効果を見積もります.'
                        : type === 'price'
                          ? '値段を変えた記録の表とモデルの定義を置いて, 商品ごとに利益が最も大きい値段を選びます.'
                          : type === 'demand'
                            ? '需要の記録の表とモデルの定義を置いて, 商品ごとの発注の数を決めます.'
                            : 'データセットとモデルの定義を置いて学習します.'}
          </>
        )}
      </p>
      <div className="flex flex-col gap-3">
        <PathField
          id="project-path"
          label="書き出すディレクトリ (無ければ作る)"
          value={path}
          onChange={(value) => {
            setPath(value)
            write.reset()
          }}
          pickFiles={false}
        />
        <div>
          <label htmlFor="experiment-name" className="mb-1 block text-xs font-medium text-ink-2">
            実験の名前 (任意. 省略すると{DEFAULT_NAMES[type]}から)
          </label>
          <input
            id="experiment-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              write.reset()
            }}
            className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => {
              setOverwrite(event.target.checked)
              write.reset()
            }}
          />
          既にあるファイル (problem.yaml, README.md, configs,{' '}
          {type === 'ready' || type === 'search' || type === 'group_ready'
            ? 'bundle.py'
            : 'train.py'}
          {type === 'policy' ? ', model.py, env.py' : ''}, 入れたデータの写しの data/) を上書きする
        </label>
        {errors.length > 0 && !write.data && (
          <section
            aria-labelledby="open-errors-title"
            className="rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-sm"
          >
            <h3 id="open-errors-title" className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle className="size-4 shrink-0 text-critical-text" aria-hidden />
              直すところが {errors.length} 件残っています
            </h3>
            <p id="open-errors-note" className="mb-2 text-xs text-ink-2">
              直してから書き出すことを勧めます. 残ったまま書き出すと, 書き出した README.md
              の最後に一覧を残します.{' '}
              {checked
                ? '問題の設定の確かめの直すところが残るので, 推論の段階 (ML-Provide) に渡す値を作れず, 直すまで問題の設定につなげません.'
                : '入れたデータの確かめの直すところだけなので, 推論の段階 (ML-Provide) に渡す値は作れますが, 同じ誤りのまま使われないように, 直すまで問題の設定にはつなぎません.'}
              {dropped &&
                (type === 'uplift'
                  ? ' 損得と制約に直すところが残るので, 配る数の上限を付けずに (config の uplift.budget を空にして) 書き出します.'
                  : type === 'price'
                    ? ' 損得と制約に直すところが残るので, 値段の候補と変える幅の上限を付けずに (config の price.candidates と price.max_change を空にして) 書き出します. 空のままでは学習の前に止まります.'
                    : type === 'demand'
                      ? ' 損得と制約に直すところが残るので, 発注の判断の損と上限を付けずに (config の order を空にして) 書き出します. 空のままでは学習の前に止まります.'
                      : ' 損得と制約に直すところが残るので, 推論の一式は意思決定の既定値を付けずに作ります.')}
            </p>
            <ul aria-label="残っている直すところ" className="mb-2 list-disc pl-5 text-xs">
              {errors.map((finding) => {
                const title = questionTitle(problem, finding)
                return (
                  <li key={`${finding.id}:${finding.message}`} className="break-words">
                    {title ?? <span className="font-mono">{finding.id}</span>}:{' '}
                    <span className="whitespace-pre-line">{finding.message}</span>
                  </li>
                )
              })}
            </ul>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={accepted}
                aria-describedby="open-errors-note"
                onChange={(event) => {
                  setConfirmed(event.target.checked ? signature : null)
                  write.reset()
                }}
              />
              それでも書き出す (一覧を確かめた)
            </label>
          </section>
        )}
        {write.error && <ErrorBox error={write.error} />}
        {write.data && (
          <div
            role="status"
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
          >
            <p className="mb-1">書き出しました: {write.data.path}</p>
            <ul className="mb-2 list-disc pl-5 font-mono text-xs">
              {write.data.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
            <p className="mb-2 text-xs text-ink-2">
              この場所を問題の設定に記録しました
              {places.length > 0 && (
                <>
                  .{' '}
                  {places.map(([label, place], index) => (
                    <Fragment key={label}>
                      {index > 0 && ', '}
                      {label}は <span className="font-mono [overflow-wrap:anywhere]">{place}</span>
                    </Fragment>
                  ))}{' '}
                  に置きます
                </>
              )}{' '}
              (後ろの段階のアプリはこの記録から場所を読みます)
            </p>
            <p className="mb-1 font-medium">次にすること (書き出した README.md にも同じ手順)</p>
            {type === 'group_ready' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>群に分ける写真のディレクトリを config の data.photos の場所に置く</li>
                <li>
                  一式を作る環境に ML-Inference と, torchvision の重みを読む ML-ModelControl
                  (ml-modelcontrol[torchvision]) を入れ, データの分析, モデルの作成, 学習は通らずに
                  bundle.py を動かす. 写真を既製のモデルで埋め込み, k-means
                  で群に分けて群の安定性と群の要約を outputs/groups に残し, outputs/inference
                  に既製の埋め込みの群分けの一式を作る (重みは一式に写さず,
                  使うときに出どころから読む)
                </li>
                <li>
                  hash を決めていなければ, 作るときに求めた hash が出るので, config の ready.sha256
                  と問題の設定に書くと次から固定できる
                </li>
                <li>
                  ML-Provide に一式を登録し, 写真を渡して, 写真ごとの群と群の要約を見る
                  {write.variables?.accept &&
                    '. 一式は作れるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'search' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  索引にする写真のディレクトリを config の data.photos の場所に置く. 写真が
                  &lt;種類&gt;/&lt;写真&gt; の形なら, 種類を評価の正解に使う (無ければ評価は無く,
                  並んだ写真と近さを見て確かめる)
                </li>
                <li>
                  一式を作る環境に ML-Inference と, torchvision の重みを読む ML-ModelControl
                  (ml-modelcontrol[torchvision]) を入れ, データの分析, モデルの作成, 学習は通らずに
                  bundle.py を動かす. 写真を既製のモデルで埋め込み, 索引と検証用の問いに分けて
                  Recall@K と NDCG@K を数え, outputs/inference に検索の一式を作る
                  (重みは一式に写さず, 使うときに出どころから読む)
                </li>
                <li>
                  hash を決めていなければ, 作るときに求めた hash が出るので, config の ready.sha256
                  と問題の設定に書くと次から固定できる
                </li>
                <li>
                  ML-Provide に一式を登録し, 問いの写真を渡して, 見た目の近い順の写真と 1
                  件の問いの待ち時間を見る
                  {write.variables?.accept &&
                    '. 一式は作れるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'ready' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  一式を作る環境に ML-Inference と, torchvision の重みを読む ML-ModelControl
                  (ml-modelcontrol[torchvision]) を入れ, データの分析, モデルの作成, 学習は通らずに
                  bundle.py を動かす. config (configs/default/bundle.yaml) の ready の値で,
                  outputs/inference に推論の一式を作る (重みは一式に写さず,
                  使うときに出どころから読む)
                </li>
                <li>
                  hash を決めていなければ, 作るときに求めた hash が出るので, config の ready.sha256
                  と問題の設定に書くと次から固定できる
                </li>
                <li>
                  ML-Provide に一式を登録し, 画像を渡して種類の名前と確信の度合いを返す.
                  当たり具合は, 比べる正解が無いので確かめ方で別に確かめる
                  {write.variables?.accept &&
                    '. 一式は作れるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'policy' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  {envId
                    ? `環境は Gymnasium の ${envId} (config の env.id). 学習する環境に ML-Found と Gymnasium を入れる`
                    : '環境の登録名を答えていないので, 自作の環境の雛形 env.py (ProjectEnv) を課題の環境 (自作のシミュレータ, 実機とのつなぎ) に書き換える. 登録した環境なら config の env.id に名前を書く'}
                </li>
                <li>
                  守り: config の guards に, 問題の設定の守り (行動の上限と止める条件の文)
                  を観測と行動の空間に合わせた数で書く. 範囲と方策を使ってよいかは決める人が決める
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かして学習する (方策のモデルは model.py
                  の PolicyNet)
                </li>
                <li>
                  学習の後に, 実験の中の policy/ に守りと一緒に方策の一式を書き出し,
                  守りを当てたまま環境で動かした結果を evaluations/ に書く. 実機での実行は道具の外
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'generate' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  ML-Fathom で画像のディレクトリを読み, 目的の列の無いレシピで検証用の分割を作って
                  outputs/dataset に書き出す (画像のディレクトリを入れていれば data/ に写してある)
                </li>
                <li>
                  ML-CreateArchitecture で組んだ定義 (入力は雑音を加えた画像と時刻,
                  出力は加えた雑音) を models/model.yaml に保存する.
                  定義が無いうちは仮のモデルで学習する
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かして学習する. 損失と,
                  作った画像の見本 (samples/) で見る
                </li>
                <li>
                  定義を置いて学習すると, train.py が実験の中の inference/
                  に件数と種で画像を作る推論の一式を作るので, ML-Provide に登録する
                  (仮のモデルでは作らない)
                  {write.variables?.accept &&
                    '. inference/ は登録できるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'table' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  ML-Fathom で表を読み, 目的の列の無いレシピで検証用の分割を作って outputs/dataset
                  に書き出す. 書き出した列を全て作るので, ID のような列と作らない列は落とし,
                  欠損は埋めるか行を落とす (表を入れていれば data/ に写してある)
                </li>
                <li>
                  ML-CreateArchitecture で表の行を作るモデルを組み, models/model.yaml に保存する.
                  モデルの作成の画面で開ける例 diffusion_denoiser を, 表の列の数と種類の値の数に
                  合わせて使える (合わせる数は学習の記録 train.log の初めの行に出る).
                  定義が無いうちは仮のモデルで学習する
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かして学習する. 列ごとの分布の近さ
                  (小さいほど良い) と, 作った表の見本 (samples/) で見る
                </li>
                <li>
                  定義を置いて学習すると, train.py が実験の中の inference/
                  に行の数と種で表を作る推論の一式を作るので, ML-Provide に登録する
                  (仮のモデルでは作らない)
                  {write.variables?.accept &&
                    '. inference/ は登録できるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'rank' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  反応の表 (1 行が 1 つの反応. 利用者, 品物, 時刻の列)
                  を学習の設定のデータの場所に置く (表を入れていれば data/ に写してあり,
                  そのまま読む)
                </li>
                <li>
                  ML-CreateArchitecture で利用者と品物の点数を出すモデルを組み, models/model.yaml
                  に保存する. モデルの作成の画面で開ける例 two_tower_retrieval を,
                  {
                    '利用者と品物の数に合わせて使える (合わせる数は学習の記録 train.log の初めの行に出る). '
                  }
                  定義が無いうちは仮のモデルで学習する
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かして学習する. 反応を時刻の順に分け,
                  利用者ごとに上位 K 件を並べて Recall@K と NDCG (大きいほど良い) を数え,
                  人気順と比べる
                </li>
                <li>
                  学習の後に, 推論に使う一式を実験の inference/ に作るので, ML-Provide の実験の
                  一覧から登録して推論する. 作れない定義のときは, その理由を train.log に書く
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'group' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  群を作る表 (1 行が 1 つの対象. 顧客など) を学習の設定のデータの場所に置く
                  (表を入れていれば data/ に写してあり, そのまま読む). 読むのは群を作る列と
                  行を見分ける列だけ
                </li>
                <li>
                  ML-CreateArchitecture で行の特徴から埋め込みを作るモデルを組み, models/model.yaml
                  に保存する. モデルの作成の画面で開ける例 contrastive_encoder を,
                  {'符号化した行の幅に合わせて使える (幅は学習の記録 train.log の初めの行に出る). '}
                  定義が無いうちは仮のモデルで学習する
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かし, 群のまとまり (大きいほど良い)
                  で最も良いモデルを選ぶ. 学習の後に群の安定性と群の要約を evaluations/ に書き,
                  列をそのまま群に分けたものと比べる
                </li>
                <li>
                  推論の一式は作らない. 実験に学習した重み, 行ごとの群の割り当て,
                  列の符号化と群の中心が残り, その実験で新しい行を群に割り当てられる
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : type === 'anomaly' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  {
                    'ML-Fathom の「問題の設定から始める」か ML-EDA の書き出しで, 異常の検知の表をデータセットの書き出し先 (config の data.dataset. 既定は outputs/dataset) に書き出す. 学習用は正常の行だけで, 異常の行は検証用とテスト用に入る. 欠けた値と種類の列は前処理で無くす (表を入れていれば data/ に写してある)'
                  }
                </li>
                <li>
                  {distance
                    ? 'モデルの定義は要らない (距離は学習用の正常の行の中心と散らばりを数えるだけ)'
                    : 'ML-CreateArchitecture で行を縮めて戻す自己符号化器を組み, models/model.yaml に保存する. モデルの作成の画面で開ける例 tabular_autoencoder を, 列の数に合わせて使える (列の数は学習の記録 train.log の初めの行に出る). 定義が無いうちは仮のモデルで学習する'}
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かす.{' '}
                  {labeled
                    ? '異常の行のある分割で, 上位 K 件の適合率と PR-AUC を evaluations/ に書く'
                    : '正解が無いので, 度合いの分布と上位 K 行の要約 (行の id, 度合い, 最も外れた列) を evaluations/ に書く'}
                </li>
                <li>
                  学習の後に, 異常の度合いの一式を実験の inference/ に作る
                  {!distance && ' (仮のモデルでは作らない)'}. 推論の 1 回で,
                  度合いの高い順に人が確かめる件数の上限まで人の確認に回す
                  {write.variables?.accept &&
                    '. 一式は ML-Provide に登録して使えるが, 書き出した README.md の最後に残した「直すところ」を問題の設定で直すまで, 一式に問題の設定 (件数の上限など) はつながらない'}
                </li>
              </ol>
            ) : type === 'uplift' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  {
                    'ML-Fathom の「問題の設定から始める」か ML-EDA の書き出しで, 介入の記録の表をデータセットの書き出し先 (config の data.dataset. 既定は outputs/dataset) に書き出す. 分割は処置で層を作り, 全ての分割に処置の群と対照の群が入る. 処置は無作為に配った記録を前提にするので, ML-EDA の describe_uplift で群の釣り合いと配った後に決まる列を確かめる. 欠けた値は前処理で無くし, 種類の列は one_hot で数の列にする (表を入れていれば data/ に写してある)'
                  }
                </li>
                <li>
                  {
                    'ML-CreateArchitecture で, 行の特徴 x から処置したときの予測 treated としないときの予測 control を出す定義を組み, models/model.yaml に保存する. モデルの作成の画面で開ける例 tabular_uplift を, 列の数に合わせて使える (列の数は学習の記録 train.log の初めの行に出る). 定義が無いうちは仮のモデルで学習する'
                  }
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かす. 検証用とテスト用の分割で, Qini
                  の係数 (効果の大きい順に配ったときに, でたらめに配るよりどれだけ良いか) と上位 K
                  割の効果の差 (処置の群と対照の群の結果の平均の差) と Qini の曲線を evaluations/
                  に書き, 行ごとの効果 (uplift_effects.csv) を実験に残す
                </li>
                <li>
                  学習の後に, 推論の段階が読む効果の決め方 (uplift_estimator.json)
                  と前処理のレシピの写しを実験に残す. 推論の 1 回で, 効果の高い順に配る数の上限まで
                  配る. 配った効果は, 配る相手を無作為に分けて試して確かめる
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                  {write.variables?.dropped &&
                    '. 損得と制約に直すところが残ったので, 配る数の上限は空 (config の uplift.budget) のまま'}
                </li>
              </ol>
            ) : type === 'price' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  {
                    'ML-Fathom の「問題の設定から始める」か ML-EDA の書き出しで, 値段を変えた記録の表をデータセットの書き出し先 (config の data.dataset. 既定は outputs/dataset) に書き出す. 分割は値段の段 (値段の高さで行を分けた組) で層を作る. 値段は試しに変えた記録 (無作為に近い) を前提にするので, ML-EDA の describe_price で商品ごとの試した値段と, 値段と他の列の偏りを確かめる. 欠けた値は前処理で無くし, 種類の列は one_hot で数の列にする (表を入れていれば data/ に写してある)'
                  }
                </li>
                <li>
                  {
                    'ML-CreateArchitecture で, 行の特徴 x (最後の列が値段) から売れた数の予測 units を出す定義を組み, models/model.yaml に保存する. モデルの作成の画面で開ける例 tabular_price を, 列の数に合わせて使える (列の数は学習の記録 train.log の初めの行に出る). 定義が無いうちは仮のモデルで学習する'
                  }
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かす. 学習の後に,
                  今の値段に候補の割合をかけた値段で売れた数を予測し,
                  変える幅の上限を超えない候補の中で見込みの利益 ((値段 − 原価) × 予測した数)
                  が最も大きい値段を商品ごとに選ぶ. 検証用とテスト用の分割で, 売れた数の誤差, 弾力性
                  (値段を 1 % 上げたときに売れた数が何 % 変わるか) と見込みの利益の比べを
                  evaluations/ に書き, 商品ごとの選んだ値段 (price_choices.csv) を実験に残す
                </li>
                <li>
                  学習の後に, 推論の段階が読む値段の決め方 (price_estimator.json)
                  と前処理のレシピの写しを実験に残し, ML-Inference の値段の一式を実験の inference/
                  に作る (config の data.source の元の表があれば, 一式の選んだ値段を実験と比べる.
                  仮のモデルでは作らない). 選ぶ値段は見積もりで,
                  値段を変えた効き目は値段を試して確かめる
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                  {write.variables?.dropped &&
                    '. 損得と制約に直すところが残ったので, 値段の候補と変える幅の上限は空 (config の price) のまま. 書き足すか, 直して書き出し直すまで学習の前に止まる'}
                </li>
              </ol>
            ) : type === 'demand' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  {
                    'ML-Fathom の「問題の設定から始める」か ML-EDA の書き出しで, 需要の記録の表 (1 行が商品と発注を決める日. 正解は先の期間の売れた数の合計) をデータセットの書き出し先 (config の data.dataset. 既定は outputs/dataset) に書き出す. 分割は発注を決める日の順. 過去の売れた数はずらした列 (lag) に, 曜日は列 (datetime_parts) にする. ML-EDA の describe_demand で商品ごとの記録の日数, 抜けの日と在庫が 0 の日を確かめる. 欠けた値は前処理で無くし, 種類の列は one_hot で数の列にする (表を入れていれば data/ に写してある)'
                  }
                </li>
                <li>
                  {
                    'ML-CreateArchitecture で, 行の特徴 x から水準の小さい順の分位点 quantiles を出す定義を組み, models/model.yaml に保存する. モデルの作成の画面で開ける例 tabular_demand を, 列の数と学ぶ水準の数に合わせて使える (列の数は学習の記録 train.log の初めの行に出る). 定義が無いうちは仮のモデルで学習する'
                  }
                </li>
                <li>
                  ML-Found (か ML-Dashboard) で train.py を動かす. 学ぶ水準 (0.5 と水準 τ を含む)
                  の分位点の損失で学び, 学習の後に, 発注を決める日の行ごとに τ (品切れの損 /
                  (品切れの損 + 売れ残りの損))
                  の分位点から在庫の数を引いた数の切り捨てと切り上げのうち,
                  見込みの損の小さい方を上限で切って発注の数を決める. 検証用とテスト用の分割で, 0.5
                  の分位点の誤差, 分位点の損失と,
                  実際の需要での発注の数の損と前の期間と同じ数の発注の損の比べを evaluations/
                  に書き, 発注の数 (demand_orders.csv) を実験に残す
                </li>
                <li>
                  学習の後に, 推論の段階が読む需要の決め方 (demand_estimator.json)
                  と前処理のレシピの写しを実験に残し, ML-Inference の需要の一式を実験の inference/
                  に作る (config の data.source の元の表があれば, 一式の発注の数を実験と比べる.
                  仮のモデルでは作らない). 発注の数は見積もりで, 品切れの多い商品は需要を少なめに
                  見積もるので, 実際の損は発注の後の売れた数で確かめる
                  {write.variables?.accept &&
                    '. README.md の最後の一覧を直すまで問題の設定はつながない'}
                  {write.variables?.dropped &&
                    '. 損得と制約に直すところが残ったので, 発注の判断の損と上限は空 (config の order) のまま. 書き足すか, 直して書き出し直すまで学習の前に止まる'}
                </li>
              </ol>
            ) : type === 'items' ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  データセットを入れていれば data/ の写しを読む. 入れていなければ, README.md の
                  ML-EDA の書き出しの関数でデータセットを outputs/dataset に書き出す
                </li>
                <li>
                  ML-CreateArchitecture で組んだ定義を models/model.yaml (config の model.spec
                  の場所) に保存する. 定義が無いうちは仮のモデルで学習する
                </li>
                <li>ML-Found (か ML-Dashboard) で train.py を動かして学習する</li>
                <li>
                  定義を置いて学習すると, train.py が実験の中の inference/ に推論の一式を作るので,
                  ML-Provide に登録して推論する (仮のモデルでは作らない)
                  {write.variables?.accept &&
                    '. inference/ は登録できるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                </li>
              </ol>
            ) : (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  ML-Fathom でデータを読み, 右の「データの分析」の値でデータセットを outputs/dataset
                  に書き出す
                </li>
                <li>ML-CreateArchitecture でモデルを組み, models/model.yaml に置く</li>
                <li>
                  ML-Dashboard の「学習の準備」で要るもの (config の requires) を入れ, train.py
                  を動かして学習する. 今のやり方をデータで書いていれば,
                  検証用とテスト用で今のやり方と比べた評価も残る
                </li>
                <li>
                  実験の中の inference/ を ML-Provide に登録して推論する
                  {write.variables?.accept &&
                    '. inference/ は登録できるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
                  {write.variables?.dropped &&
                    '. 損得と制約に直すところが残ったので, 一式に意思決定の既定値は付かない'}
                </li>
              </ol>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            閉じる
          </Button>
          <Button
            variant="primary"
            icon={FolderOutput}
            // 直すところが残っていれば, 「それでも書き出す」を確かめるまで押せない. 書き出した後は,
            // 場所, 名前, 上書きを変えるまで押せない (同じ場所の書き出し直しは上書きの誤りになるため)
            disabled={
              !path.trim() || write.isPending || write.isSuccess || (errors.length > 0 && !accepted)
            }
            aria-describedby={errors.length > 0 && !accepted ? 'open-errors-title' : undefined}
            onClick={() => write.mutate({ accept: accepted, dropped: accepted && dropped })}
          >
            {write.isPending
              ? '書き出しています…'
              : write.isSuccess
                ? '書き出しました'
                : accepted
                  ? '直すところが残ったまま書き出す'
                  : '書き出す'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
