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

/** 問いの答えの正解の種類 (受け渡しの値は直すところが残ると無いので, 問いの答えから読む) */
function targetKind(problem: Problem): string | null {
  const value = problem.questions.find((q) => q.id === 'ml.parts.0.target.kind')?.value
  return typeof value === 'string' ? value : null
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
  // 画像の領域と点群は, 列の予測と既定の名前と次にすることが違う
  const kind = targetKind(problem)
  const items = kind !== null && ITEMS_KINDS.includes(kind)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  // 「それでも書き出す」は確かめた一覧の印で覚える (一覧が変われば確かめ直す)
  const errors = problem.open_errors
  const signature = errors.map((f) => `${f.id}\u0000${f.message}`).join('\u0001')
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const accepted = errors.length > 0 && confirmed === signature
  const client = useQueryClient()
  const write = useMutation({
    mutationFn: () =>
      api.writeProject(problem.id, {
        path: path.trim(),
        name: name.trim() || undefined,
        overwrite,
        // 一覧を確かめたときだけ
        accept_errors: accepted || undefined,
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
            実験の名前 (任意. 省略すると{items ? '正解の種類と受け持ち' : '目的の列とタスク'}から)
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
            onChange={(event) => setOverwrite(event.target.checked)}
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
              の最後に一覧を残し, 直すまで推論の段階 (ML-Provide) で問題の設定につなげません.
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
            {items ? (
              <ol className="list-decimal pl-5 text-xs">
                <li>
                  データセットを入れていれば data/ の写しを読む. 入れていなければ, README.md の
                  ML-EDA の書き出しの関数でデータセットを outputs/dataset に書き出す
                </li>
                <li>
                  仮のモデルのままでも動く. ML-CreateArchitecture で組んだモデルは, config の
                  model.spec に定義の場所を書く
                </li>
                <li>ML-Found (か ML-Dashboard) で train.py を動かして学習する</li>
                <li>推論の一式はまだ書き出さない (README.md を参照)</li>
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
                <li>実験の中の inference/ を ML-Provide に登録して推論する</li>
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
            // 直すところが残っていれば, 「それでも書き出す」を確かめるまで押せない
            disabled={!path.trim() || write.isPending || (errors.length > 0 && !accepted)}
            aria-describedby={errors.length > 0 && !accepted ? 'open-errors-title' : undefined}
            onClick={() => write.mutate()}
          >
            {write.isPending
              ? '書き出しています…'
              : accepted
                ? '直すところが残ったまま書き出す'
                : '書き出す'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
