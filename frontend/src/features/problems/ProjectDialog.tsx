import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderOutput } from 'lucide-react'
import { Fragment, useState } from 'react'

import { api, ApiError } from '../../api/client'
import type { Finding, Problem } from '../../api/types'
import { Dialog } from '../../components/Dialog'
import { PathField } from '../../components/PathPicker'
import { Button, ErrorBox } from '../../components/ui'

/**
 * ファイルの組 (ML-EDA の版 2 のデータセットで学ぶ) の正解の種類. ML-Quest の ITEMS_KINDS の写しで,
 * 説明の文の出し分けだけに使う (書き出せるかの決まりは project_error だけが持つ)
 */
const ITEMS_KINDS = ['mask', 'point_cloud']

/** 問いの答え (受け渡しの値は直すところが残ると無いので, 問いの答えから読む) */
function answerOf(problem: Problem, id: string): string | null {
  const value = problem.questions.find((q) => q.id === id)?.value
  return typeof value === 'string' ? value : null
}

/**
 * 骨組みの型 (説明の文の出し分けだけ). 既製 (予測するで作り方が既製のモデルをそのまま使う.
 * 学習せず, 推論の一式だけを作る), 方策 (効果を見積もるで続けて行動を選ぶ), ファイルの組
 * (領域と点群), 画像の生成 (作るで正解の種類が画像), 表の生成 (作るで正解の種類が表), 並べる
 * (並べるで既製のモデルをそのまま使わない), 他は列の予測
 */
function skeletonType(
  problem: Problem,
): 'column' | 'items' | 'generate' | 'table' | 'rank' | 'policy' | 'ready' {
  const autonomous = problem.questions.find((q) => q.id === 'ml.parts.0.autonomous')
  // ML-Quest の is_pretrained_part と同じく, 予測するで, 作り方の問いが有効なときだけ
  const method = problem.questions.find((q) => q.id === 'ml.parts.0.method')
  if (
    answerOf(problem, 'ml.parts.0.role') === 'predict' &&
    method?.applies &&
    method.value === 'pretrained'
  )
    return 'ready'
  if (
    answerOf(problem, 'ml.parts.0.role') === 'effect' &&
    autonomous?.applies &&
    autonomous.value === true
  )
    return 'policy'
  // ML-Quest の is_rank_part と同じく, 並べるで, 作り方が既製のモデルをそのまま使うでないとき
  if (
    answerOf(problem, 'ml.parts.0.role') === 'rank' &&
    !(method?.applies && method.value === 'pretrained')
  )
    return 'rank'
  const kind = answerOf(problem, 'ml.parts.0.target.kind')
  if (answerOf(problem, 'ml.parts.0.role') === 'generate') {
    if (kind === 'image') return 'generate'
    if (kind === 'table') return 'table'
  }
  return kind !== null && ITEMS_KINDS.includes(kind) ? 'items' : 'column'
}

/** 実験の名前を省略したときの元 (ML-Quest の experiment_name と同じ) */
const DEFAULT_NAMES = {
  column: '目的の列とタスク',
  items: '正解の種類と受け持ち',
  generate: '正解の種類と受け持ち',
  table: '正解の種類と受け持ち',
  rank: '品物の列と受け持ち',
  // 英字の後は空けて読む
  policy: '環境の登録名か env ',
  // 一式の名前は, 省略するとモデルと重みの名前から
  ready: 'モデルと重みの名前',
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
  // 画像の領域と点群, 画像と表の生成, 並べる, 方策は, 列の予測と既定の名前と次にすることが違う
  const type = skeletonType(problem)
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
  // ファイルの組, 画像と表の生成, 並べる, 方策の一式は意思決定を持たないので, 損得と制約の注意は列の予測だけ
  const dropped = type === 'column' && decisionDropped(errors)
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
        {type === 'ready' ? (
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
          {type === 'ready' ? 'bundle.py' : 'train.py'}
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
                ' 損得と制約に直すところが残るので, 推論の一式は意思決定の既定値を付けずに作ります.'}
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
            {type === 'ready' ? (
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
