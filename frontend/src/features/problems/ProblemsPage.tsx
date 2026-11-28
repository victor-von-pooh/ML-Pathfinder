import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Compass, FileInput, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { useApi } from '../../api/client'
import type { Problem, ProblemItem } from '../../api/types'
import { PathPicker } from '../../components/PathPicker'
import { Button, Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../../components/ui'
import { formatTime } from '../../lib/format'
import { useStage } from '../../lib/stage'

/** 一覧の行の状態 (渡せる, 機械学習を使わないで終えた, 直すところ, 途中) */
function Status({ item }: { item: ProblemItem }) {
  if (item.ready)
    return (
      <span className="inline-flex items-center gap-1 text-good-text">
        <CheckCircle2 size={14} aria-hidden />
        後ろの段階に渡せる
      </span>
    )
  if (item.finished) return <span className="text-ink-2">機械学習を使わないで終えた</span>
  return (
    <span className="text-ink-3">
      答えた問い {item.progress.answered} / {item.progress.required}
      {item.errors > 0 && ` (直すところ ${item.errors})`}
    </span>
  )
}

/** 問題の一覧と, 新しく作る欄 */
export function ProblemsPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { onProjectsChange } = useStage()
  // 作るか取り込んだら, 殻に一覧の変化を知らせて開く (開いた知らせは問題の設定の画面が出す)
  const opened = (view: Problem) => {
    onProjectsChange()
    void navigate(`/problems/${view.id}`)
  }
  const items = useQuery({ queryKey: ['problems'], queryFn: api.problems })
  const info = useQuery({ queryKey: ['info'], queryFn: api.info })
  const [name, setName] = useState('')
  const [importing, setImporting] = useState(false)
  const create = useMutation({
    mutationFn: api.create,
    onSuccess: opened,
  })
  const importProblem = useMutation({
    mutationFn: api.importProblem,
    onSuccess: opened,
  })
  return (
    <>
      <PageHeader
        title="問題の設定"
        subtitle="課題から始めて, どの部分を機械学習に任せると課題が解けるかを決める"
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card title="問題の一覧" padded={false}>
          {items.isPending && <Spinner />}
          {items.error && <ErrorBox error={items.error} live={false} />}
          {items.data?.length === 0 && (
            <div className="p-4">
              <EmptyState icon={Compass} title="まだ問題がありません">
                右の欄で名前を書いて作るか, 見本を開いてください.
              </EmptyState>
            </div>
          )}
          {!!items.data?.length && (
            <ul aria-label="問題の一覧" className="divide-y divide-line">
              {items.data.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Link
                    to={`/problems/${item.id}`}
                    className="min-w-0 flex-1 truncate font-medium text-accent-text hover:underline"
                  >
                    {item.name}
                  </Link>
                  <span className="text-sm">
                    <Status item={item} />
                  </span>
                  <span className="text-xs text-ink-3">{formatTime(item.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="新しく作る">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (name.trim()) create.mutate({ name: name.trim() })
              }}
              className="flex flex-col gap-2"
            >
              <label htmlFor="new-name" className="text-xs font-medium text-ink-2">
                問題の名前 (課題の言葉で. 例: 総菜の作る量, 計測からの形の再構成, 遊び続ける時間)
              </label>
              <input
                id="new-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                className="h-8 rounded-lg border border-line bg-surface px-2 text-sm"
              />
              <Button
                type="submit"
                variant="primary"
                icon={Plus}
                disabled={!name.trim() || create.isPending}
              >
                作る
              </Button>
            </form>
            {create.error && <ErrorBox error={create.error} />}
          </Card>
          <Card title="見本を開く">
            <p className="mb-3 text-xs text-ink-2">
              架空の課題で答えを埋めた見本. 開くと写しが一覧に入る (元の見本は変わらない).
              同じ名前が一覧にあれば「名前 (2)」のように番号を付ける.
            </p>
            <div className="flex flex-col gap-2">
              {info.data?.examples.map((example) => (
                <Button
                  key={example}
                  icon={Sparkles}
                  className="justify-start"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ example })}
                >
                  {example}
                </Button>
              ))}
            </div>
          </Card>
          <Card title="ファイルから取り込む">
            <p className="mb-3 text-xs text-ink-2">
              書き出した problem.yaml (かそれを持つディレクトリ) を写して取り込む.
            </p>
            <Button icon={FileInput} onClick={() => setImporting(true)}>
              problem.yaml を選ぶ
            </Button>
            {importProblem.error && <ErrorBox error={importProblem.error} />}
          </Card>
        </div>
      </div>
      {importing && (
        <PathPicker
          title="problem.yaml を選ぶ"
          onClose={() => setImporting(false)}
          onPick={(path) => {
            setImporting(false)
            importProblem.mutate(path)
          }}
        />
      )}
    </>
  )
}
