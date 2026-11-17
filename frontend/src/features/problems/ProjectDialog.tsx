import { useMutation } from '@tanstack/react-query'
import { FolderOutput } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api/client'
import type { Problem } from '../../api/types'
import { Dialog } from '../../components/Dialog'
import { PathField } from '../../components/PathPicker'
import { Button, ErrorBox } from '../../components/ui'

/** ML-Found のプロジェクトの骨組みを書き出す対話 */
export function ProjectDialog({ problem, onClose }: { problem: Problem; onClose: () => void }) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const write = useMutation({
    mutationFn: () =>
      api.writeProject(problem.id, {
        path: path.trim(),
        name: name.trim() || undefined,
        overwrite,
      }),
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
            実験の名前 (任意. 省略すると目的の列とタスクから)
          </label>
          <input
            id="experiment-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          既にあるファイルを上書きする
        </label>
        {write.error && <ErrorBox error={write.error} />}
        {write.data && (
          <div
            role="status"
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
          >
            <p className="mb-1">書き出しました: {write.data.path}</p>
            <ul className="list-disc pl-5 font-mono text-xs">
              {write.data.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
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
