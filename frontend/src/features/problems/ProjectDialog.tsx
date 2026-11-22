import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FolderOutput } from 'lucide-react'
import { useState } from 'react'

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
 * 骨組みの型 (説明の文の出し分けだけ). ファイルの組 (領域と点群), 画像の生成 (作るで正解の
 * 種類が画像), 他は列の予測
 */
function skeletonType(problem: Problem): 'column' | 'items' | 'generate' {
  const kind = answerOf(problem, 'ml.parts.0.target.kind')
  if (answerOf(problem, 'ml.parts.0.role') === 'generate' && kind === 'image') return 'generate'
  return kind !== null && ITEMS_KINDS.includes(kind) ? 'items' : 'column'
}

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
  // 画像の領域と点群, 画像の生成は, 列の予測と既定の名前と次にすることが違う
  const type = skeletonType(problem)
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
  // ファイルの組と画像の生成の推論の一式は意思決定を持たないので, 損得と制約の注意は列の予測だけ
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
  return (
    <Dialog title="学習のプロジェクトを書き出す" onClose={onClose}>
      <p className="mb-3 text-xs text-ink-2">
        ML-Found のプロジェクトの骨組み (config, train.py, README, problem.yaml の写し)
        を書き出します. 書き出した README の「次にすること」の順に,
        データセットとモデルの定義を置いて学習します.
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
            実験の名前 (任意. 省略すると
            {type === 'column' ? '目的の列とタスク' : '正解の種類と受け持ち'}から)
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
          既にあるファイル (problem.yaml, README.md, configs, train.py) を上書きする
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
              この場所を問題の設定に記録しました. データセットは{' '}
              <span className="font-mono [overflow-wrap:anywhere]">
                {write.data.project.dataset}
              </span>
              {write.data.project.model_spec && (
                <>
                  , モデルの定義は{' '}
                  <span className="font-mono [overflow-wrap:anywhere]">
                    {write.data.project.model_spec}
                  </span>
                </>
              )}{' '}
              に置きます (後ろの段階のアプリはこの記録から場所を読みます)
            </p>
            <p className="mb-1 font-medium">次にすること (書き出した README.md にも同じ手順)</p>
            {type === 'generate' ? (
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
                  定義を置いて学習すると, train.py が実験の中の inference/ に件数と種で画像を作る
                  推論の一式を作るので, ML-Provide に登録する (仮のモデルでは作らない)
                  {write.variables?.accept &&
                    '. inference/ は登録できるが, README.md の最後の一覧を直すまで問題の設定はつながない'}
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
                  を動かして学習する. 今のやり方をデータで書いていれば, 検証用とテスト用で
                  今のやり方と比べた評価も残る
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
