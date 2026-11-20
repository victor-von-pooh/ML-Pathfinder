import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FolderOutput } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api/client'
import type { Problem } from '../../api/types'
import { Dialog } from '../../components/Dialog'
import { PathField } from '../../components/PathPicker'
import { Button, ErrorBox } from '../../components/ui'

/**
 * ファイルの組 (ML-EDA の版 2 のデータセットで学ぶ) の正解の種類. ML-Quest の ITEMS_KINDS の写しで,
 * 説明の文の出し分けだけに使う (書き出せるかの決まりは project_error だけが持つ)
 */
const ITEMS_KINDS = ['mask', 'point_cloud']

/** ML-Found のプロジェクトの骨組みを書き出す対話 */
export function ProjectDialog({ problem, onClose }: { problem: Problem; onClose: () => void }) {
  // 画像の領域と点群は, 列の予測と既定の名前と次にすることが違う
  const kind = problem.handoff?.training.target_kind ?? null
  const items = kind !== null && ITEMS_KINDS.includes(kind)
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const client = useQueryClient()
  const write = useMutation({
    mutationFn: () =>
      api.writeProject(problem.id, {
        path: path.trim(),
        name: name.trim() || undefined,
        overwrite,
      }),
    // 書き出した場所は問題の設定に保存されるので, 読み直して受け渡しの値に出す (読み直した
    // 印と同じなので, 他で変わった知らせは出ない)
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['problem', problem.id] })
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
            disabled={!path.trim() || write.isPending}
            onClick={() => write.mutate()}
          >
            {write.isPending ? '書き出しています…' : '書き出す'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
