import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Download, FolderOutput, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { api } from '../../api/client'
import type { Finding, Problem } from '../../api/types'
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui'
import { formatTime } from '../../lib/format'
import { HandoffCard } from './HandoffCard'
import { ProjectDialog } from './ProjectDialog'
import { LEVEL_NAMES } from '../../lib/labels'
import { QuestionField } from './QuestionField'

/** 確かめの重さの見た目 */
const LEVEL_STYLE: Record<Finding['level'], string> = {
  error: 'border-critical/30 bg-critical/5',
  warning: 'border-warning/40 bg-warning/5',
  info: 'border-line bg-surface-2',
}

/** 問いの節の一覧 (答えた数と要る数) */
function SectionList({
  problem,
  current,
  onSelect,
}: {
  problem: Problem
  current: number
  onSelect: (section: number) => void
}) {
  // 今の答えのもとで問いの無い節 (機械学習を使わない出口の 4 以降) は薄く
  return (
    <nav aria-label="問いの節">
      <ol className="flex flex-col gap-1">
        {problem.progress.sections.map((section) => {
          const done = section.required > 0 && section.answered === section.required
          const empty = !problem.questions.some((q) => q.section === section.number && q.applies)
          return (
            <li key={section.number}>
              <button
                type="button"
                aria-current={section.number === current ? 'step' : undefined}
                onClick={() => onSelect(section.number)}
                className={clsx(
                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  section.number === current
                    ? 'bg-accent-soft font-medium text-accent-text'
                    : 'text-ink-2 hover:bg-surface-2',
                  empty && 'opacity-50',
                )}
              >
                <span className="tabular w-5 text-right text-xs text-ink-3">{section.number}</span>
                <span className="flex-1">{section.title}</span>
                {done ? (
                  <CheckCircle2 size={14} className="text-good-text" aria-label="答えた" />
                ) : (
                  section.required > 0 && (
                    <span className="tabular text-xs text-ink-3">
                      {section.answered}/{section.required}
                    </span>
                  )
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** 全体の確かめ (直す, 見直す, 知らせ) */
function FindingsCard({
  findings,
  sectionOf,
  onSelect,
}: {
  findings: Finding[]
  sectionOf: (id: string) => number | undefined
  onSelect: (section: number) => void
}) {
  return (
    <Card title={`確かめ (${findings.length})`}>
      {findings.length === 0 ? (
        <p className="text-sm text-good-text">食い違いや足りない答えはありません.</p>
      ) : (
        <ul aria-label="確かめ" className="flex flex-col gap-2">
          {findings.map((finding) => {
            const section = sectionOf(finding.id)
            return (
              <li
                key={`${finding.id}:${finding.message}`}
                className={clsx('rounded-lg border px-3 py-2 text-sm', LEVEL_STYLE[finding.level])}
              >
                <span className="mr-1 text-xs font-medium text-ink-2">
                  {LEVEL_NAMES[finding.level]}
                </span>
                {finding.message}
                {section !== undefined && (
                  <button
                    type="button"
                    onClick={() => onSelect(section)}
                    className="ml-1 text-xs text-accent-text underline"
                  >
                    {section} へ
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** 1 つの問題の設定を, 節ごとの問いで埋める画面 */
export function ProblemPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['problem', id], queryFn: () => api.problem(id) })
  const [section, setSection] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  // 保存した結果を画面に入れ, 一覧も読み直す
  const store = (view: Problem) => {
    client.setQueryData(['problem', id], view)
    client.invalidateQueries({ queryKey: ['problems'] })
  }
  const answer = useMutation({
    mutationFn: ({ question, value }: { question: string; value: unknown }) =>
      api.answer(id, question, value),
    onSuccess: store,
  })
  const columns = useMutation({
    mutationFn: (path: string) => api.readColumns(id, path),
    onSuccess: store,
  })
  const rename = useMutation({
    mutationFn: (name: string) => api.rename(id, name),
    onSuccess: (view) => {
      store(view)
      setRenaming(null)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.remove(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['problems'] })
      navigate('/')
    },
  })
  if (query.isPending) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} live={false} />
  const problem = query.data
  const busy = answer.isPending || columns.isPending
  const shown = problem.questions.filter((q) => q.section === section)
  const visible = shown.filter((q) => q.applies)
  const columnValue = problem.questions.find((q) => q.id === 'information.columns')?.value
  const columnNames = Array.isArray(columnValue) ? (columnValue as string[]) : []
  const sectionOf = (key: string) => problem.questions.find((q) => q.id === key)?.section
  const title = problem.progress.sections.find((s) => s.number === section)?.title ?? ''
  const error = answer.error ?? columns.error
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/">問題の設定</Link>}
        title={problem.name}
        subtitle={`更新 ${formatTime(problem.updated_at)}. 答えた問い ${problem.progress.answered} / ${problem.progress.required}`}
        actions={
          <>
            <Button icon={Pencil} onClick={() => setRenaming(problem.name)}>
              名前を変える
            </Button>
            <a
              href={api.downloadUrl(id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            >
              <Download className="size-4" aria-hidden />
              problem.yaml
            </a>
            <Button
              variant="primary"
              icon={FolderOutput}
              disabled={!problem.ready}
              title={problem.ready ? undefined : '直すところが残っていると書き出せません'}
              onClick={() => setExporting(true)}
            >
              学習のプロジェクトを書き出す
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              aria-label="消す"
              disabled={remove.isPending}
              onClick={() => window.confirm(`「${problem.name}」を消しますか?`) && remove.mutate()}
            />
          </>
        }
      />
      {renaming !== null && (
        <form
          className="mb-4 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (renaming.trim()) rename.mutate(renaming.trim())
          }}
        >
          <label htmlFor="rename" className="text-sm">
            新しい名前
          </label>
          <input
            id="rename"
            value={renaming}
            maxLength={80}
            onChange={(event) => setRenaming(event.target.value)}
            className="h-8 w-80 rounded-lg border border-line bg-surface px-2 text-sm"
          />
          <Button type="submit" variant="primary" disabled={!renaming.trim() || rename.isPending}>
            変える
          </Button>
          <Button variant="ghost" onClick={() => setRenaming(null)}>
            やめる
          </Button>
          {rename.error && <ErrorBox error={rename.error} />}
        </form>
      )}
      {problem.finished && (
        <div className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
          機械学習を使わないと決めて終えました. 後ろの段階に渡すものはありません (4
          の「機械学習を使いますか」を変えると続けられます).
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)_24rem]">
        <SectionList problem={problem} current={section} onSelect={setSection} />
        <Card
          title={`${section}. ${title}`}
          actions={
            <div className="flex gap-2">
              <Button disabled={section <= 1} onClick={() => setSection(section - 1)}>
                前の節
              </Button>
              <Button disabled={section >= 10} onClick={() => setSection(section + 1)}>
                次の節
              </Button>
            </div>
          }
        >
          {error && <ErrorBox error={error} />}
          {visible.length === 0 && (
            <p className="text-sm text-ink-3">
              {problem.uses_ml === false
                ? '機械学習を使わないので, この節の問いはありません.'
                : problem.uses_ml === null
                  ? '4 の「機械学習を使いますか」に答えると, この節の問いが出ます.'
                  : 'この節の問いは, 前の節の答え (タスクなど) で要らなくなりました.'}
            </p>
          )}
          {visible.map((question) => (
            <QuestionField
              key={question.id}
              question={question}
              columns={columnNames}
              findings={problem.findings.filter((f) => f.id === question.id)}
              busy={busy}
              onAnswer={(value) => answer.mutate({ question: question.id, value })}
              onReadColumns={
                question.id === 'information.columns' ? (path) => columns.mutate(path) : undefined
              }
            />
          ))}
          <p role="status" aria-live="polite" className="mt-2 text-xs text-ink-3">
            {busy ? '保存しています…' : answer.isSuccess ? '保存しました' : ''}
          </p>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="課題から行動までの筋道">
            {problem.summary.length === 0 ? (
              <p className="text-sm text-ink-3">答えると, ここに筋道がまとまります.</p>
            ) : (
              <ul aria-label="筋道" className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {problem.summary.map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
            )}
          </Card>
          <FindingsCard findings={problem.findings} sectionOf={sectionOf} onSelect={setSection} />
          <HandoffCard problem={problem} />
        </div>
      </div>
      {exporting && <ProjectDialog problem={problem} onClose={() => setExporting(false)} />}
    </>
  )
}
