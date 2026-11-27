import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Download, FolderOutput, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { useApi } from '../../api/client'
import type { Finding, Problem } from '../../api/types'
import { Button, Card, ErrorBox, PageHeader, Spinner } from '../../components/ui'
import { formatTime } from '../../lib/format'
import { LEVEL_NAMES } from '../../lib/labels'
import { useStage } from '../../lib/stage'
import { HandoffCard } from './HandoffCard'
import { ProjectDialog } from './ProjectDialog'
import { QuestionField } from './QuestionField'
import { RequiresCard } from './RequiresCard'
import { SensitivityPanel } from './SensitivityPanel'

/** 確かめの重さの見た目 */
const LEVEL_STYLE: Record<Finding['level'], string> = {
  error: 'border-critical/30 bg-critical/5',
  warning: 'border-warning/40 bg-warning/5',
  info: 'border-line bg-surface-2',
}

/** 文の終わりの句点 (ML-Quest の文は句点で終わらないことがある) */
function withPeriod(text: string): string {
  return text.endsWith('.') ? text : `${text}.`
}

/**
 * 確かめの場所の問い. 手元のデータの項目そのもの (data) と元の場所 (data.origin) の確かめは,
 * それを直す欄の 5 の「手元のデータは」(data.source) の問い
 */
function findingQuestion(problem: Problem, id: string) {
  const target = id === 'data' || id === 'data.origin' ? 'data.source' : id
  return problem.questions.find((q) => q.id === target)
}

/** 節ごとの直すところ (error) の数 */
function errorsBySection(problem: Problem): Record<number, number> {
  const counts: Record<number, number> = {}
  for (const finding of problem.findings) {
    if (finding.level !== 'error') continue
    const section = findingQuestion(problem, finding.id)?.section
    if (section !== undefined) counts[section] = (counts[section] ?? 0) + 1
  }
  return counts
}

/** 問いの節の一覧 (広い画面は縦の一覧, 狭い画面は選ぶ欄) */
function SectionList({
  problem,
  current,
  onSelect,
}: {
  problem: Problem
  current: number
  onSelect: (section: number) => void
}) {
  const errors = errorsBySection(problem)
  const isEmpty = (number: number) =>
    !problem.questions.some((q) => q.section === number && q.applies)
  return (
    <>
      <div className="xl:hidden">
        <label htmlFor="section-select" className="mb-1 block text-xs text-ink-2">
          節
        </label>
        <select
          id="section-select"
          value={current}
          onChange={(event) => onSelect(Number(event.target.value))}
          className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm"
        >
          {problem.progress.sections.map((s) => (
            <option key={s.number} value={s.number}>
              {s.number}. {s.title}
              {isEmpty(s.number)
                ? ' (今は問いなし)'
                : errors[s.number]
                  ? ` (直す ${errors[s.number]})`
                  : ` (${s.answered}/${s.required})`}
            </option>
          ))}
        </select>
      </div>
      <nav aria-label="問いの節" className="hidden xl:block">
        <ol className="flex flex-col gap-1">
          {problem.progress.sections.map((section) => {
            const empty = isEmpty(section.number)
            const count = errors[section.number] ?? 0
            const done =
              section.required > 0 && section.answered === section.required && count === 0
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
                  )}
                >
                  <span className="tabular w-5 text-right text-xs text-ink-3">
                    {section.number}
                  </span>
                  <span className={clsx('flex-1', empty && 'text-ink-3')}>{section.title}</span>
                  {empty ? (
                    <span className="text-xs text-ink-3">問いなし</span>
                  ) : count > 0 ? (
                    <span className="text-xs text-critical-text">直す {count}</span>
                  ) : done ? (
                    <span className="inline-flex items-center gap-1 text-xs text-good-text">
                      <CheckCircle2 size={14} aria-hidden />
                      答えた
                    </span>
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
    </>
  )
}

/**
 * 問題の設定の確かめとデータからの確かめを 1 つの並びにする. 同じ確かめ (データの場所の形の
 * 誤りなど, ML-Quest が両方に返すもの) は 1 つにする
 */
function joinFindings(own: Finding[], extra: Finding[]): Finding[] {
  const seen = new Set(own.map((f) => `${f.level}\u0000${f.id}\u0000${f.message}`))
  return [...own, ...extra.filter((f) => !seen.has(`${f.level}\u0000${f.id}\u0000${f.message}`))]
}

/** 全体の確かめ (直す, 見直す, 知らせ). 押すとその問いへ移る */
function FindingsCard({
  problem,
  extra,
  onJump,
}: {
  problem: Problem
  extra: Finding[]
  onJump: (questionId: string) => void
}) {
  // データからの確かめも同じ並び (重さの順) に
  const order = { error: 0, warning: 1, info: 2 }
  const findings = joinFindings(problem.findings, extra).sort(
    (a, b) => order[a.level] - order[b.level],
  )
  const titles = Object.fromEntries(problem.progress.sections.map((s) => [s.number, s.title]))
  return (
    <Card title={`確かめ (${findings.length})`}>
      {findings.length === 0 ? (
        <p className="text-sm text-good-text">食い違いや足りない答えはありません.</p>
      ) : (
        <ul aria-label="確かめ" className="flex flex-col gap-2">
          {findings.map((finding) => {
            const target = findingQuestion(problem, finding.id)
            return (
              <li
                key={`${finding.id}:${finding.message}`}
                className={clsx('rounded-lg border px-3 py-2 text-sm', LEVEL_STYLE[finding.level])}
              >
                <span className="mr-1 text-xs font-medium text-ink-2">
                  {LEVEL_NAMES[finding.level]}
                </span>
                {target && <span className="mr-1 text-xs text-ink-2">「{target.title}」</span>}
                {finding.message}
                {target && (
                  <button
                    type="button"
                    onClick={() => onJump(target.id)}
                    className="ml-1 text-xs text-accent-text underline"
                  >
                    {target.section}. {titles[target.section]} の問いへ
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
  const api = useApi()
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['problem', id], queryFn: () => api.problem(id) })
  const { project, onProjectChange, onProjectsChange } = useStage()
  // 殻の選びは知らせるかを決めるときだけ読む (殻が選びを替えたときに, 前の問題の設定を
  // 知らせ直さないため)
  const shell = useRef({ project, onProjectChange })
  useLayoutEffect(() => {
    shell.current = { project, onProjectChange }
  }, [project, onProjectChange])
  const opened = query.isSuccess
  // 開けたら殻に知らせる (殻の選びと同じなら知らせない. 知らせが行き来し続けないため)
  useEffect(() => {
    if (opened && shell.current.project !== id) shell.current.onProjectChange(id)
  }, [opened, id])
  // 今の問題の設定の形の版 (ファイルが古い版なら知らせるため. ML-Quest の版)
  const info = useQuery({ queryKey: ['info'], queryFn: api.info })
  const formatVersion = info.data?.format_version
  const [section, setSection] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  // 他のアプリ (ML-Fathom の書き戻しなど) の書き換えで読み直したか (知らせのため. 値の
  // 変わった問いの入力は, QuestionField が保存した値ごとに作り直す)
  const [reloaded, setReloaded] = useState(false)
  // 保存した結果を画面に入れ, 一覧も読み直す (自分の保存の印も覚える)
  const store = (view: Problem) => {
    client.setQueryData(['problem', id], view)
    client.setQueryData(['problem-version', id], { version: view.version })
    setReloaded(false)
    client.invalidateQueries({ queryKey: ['problems'] })
    // 答えが変わったら, データからの候補も読み直す
    client.invalidateQueries({ queryKey: ['insight', id] })
  }
  // 問題の設定を書き換える操作 (読み直しはこれらの途中は待つ)
  const editing = ['problem-edit', id]
  const answer = useMutation({
    mutationKey: editing,
    mutationFn: ({ question, value }: { question: string; value: unknown }) =>
      api.answer(id, question, value),
    onSuccess: (view, { question }) => {
      store(view)
      setSaved(view.questions.find((q) => q.id === question)?.title ?? '')
    },
  })
  const detach = useMutation({
    mutationKey: editing,
    mutationFn: () => api.detachData(id),
    onSuccess: (view) => {
      store(view)
      client.removeQueries({ queryKey: ['insight', id] })
      setSaved('手元のデータは')
    },
  })
  const attach = useMutation({
    mutationKey: editing,
    mutationFn: (path: string) => api.attachData(id, path),
    onSuccess: (view) => {
      store(view)
      setSaved('手元のデータは')
    },
  })
  const columns = useMutation({
    mutationKey: editing,
    mutationFn: (path: string) => api.readColumns(id, path),
    onSuccess: (view) => {
      store(view)
      setSaved('使えるデータの列は')
    },
  })
  const rename = useMutation({
    mutationKey: editing,
    mutationFn: (name: string) => api.rename(id, name),
    onSuccess: (view) => {
      store(view)
      onProjectsChange()
      setRenaming(null)
    },
  })
  const remove = useMutation({
    mutationFn: () => api.remove(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['problems'] })
      onProjectsChange()
      // 殻で選んでいた問題の設定を消したら, 選びを外す
      if (shell.current.project === id) shell.current.onProjectChange(null)
      void navigate('/')
    },
  })

  // ファイルの中身の印を, 画面に戻ったときと 10 秒ごとに確かめ, 他で変わったら読み直す
  // (保存の途中は待つ. 答えは 1 つずつ今のファイルに重ねて保存するので, 他の変更は消えない)
  const remote = useQuery({
    queryKey: ['problem-version', id],
    queryFn: () => api.problemVersion(id),
    enabled: query.isSuccess,
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  })
  const busy = useIsMutating({ mutationKey: editing }) > 0
  const localVersion = query.data?.version
  const remoteVersion = remote.data?.version
  const { refetch } = query
  useEffect(() => {
    if (!localVersion || !remoteVersion || localVersion === remoteVersion || busy) return
    // 読み直す間にさらに変わっても, 読み直した印で覚え直す
    void refetch().then((result) => {
      const fresh = result.data?.version
      if (!fresh || fresh === localVersion) return
      client.setQueryData(['problem-version', id], { version: fresh })
      setReloaded(true)
      client.invalidateQueries({ queryKey: ['insight', id] })
    })
  }, [localVersion, remoteVersion, busy, refetch, client, id])

  // 入れたデータからの候補 (保存のたびに store で読み直す. 分析はサーバーが覚えている).
  // 場所が文字列でない (手で書いたファイルの取り込みなど) ときも, 読めないことの確かめを出す
  // ために取りに行く
  const source = query.data?.questions.find((q) => q.id === 'data.source')?.value
  const insight = useQuery({
    queryKey: ['insight', id],
    queryFn: () => api.insight(id),
    enabled: source !== undefined && source !== null && source !== '',
  })
  if (query.isPending) return <Spinner />
  if (query.error) return <ErrorBox error={query.error} live={false} />
  const problem = query.data
  const columnValue = problem.questions.find((q) => q.id === 'information.columns')?.value
  const columnNames = Array.isArray(columnValue)
    ? columnValue.filter((v): v is string => typeof v === 'string')
    : []
  const title = problem.progress.sections.find((s) => s.number === section)?.title ?? ''
  // 手元のデータの項目の形の誤り (手で書いたファイル) があれば, 機械学習を使うと決める前でも
  // 手元のデータの欄を出す (外すか入れ直す道を残すため)
  const dataBroken = problem.findings.some(
    (f) => f.level === 'error' && findingQuestion(problem, f.id)?.id === 'data.source',
  )
  const visible = problem.questions.filter(
    (q) => q.applies || (q.id === 'data.source' && dataBroken),
  )
  const here = visible.filter((q) => q.section === section)
  // 保存中と誤りは, その問いだけに出す
  const savingId = answer.isPending ? answer.variables?.question : undefined
  const failedId = answer.isError ? answer.variables?.question : undefined
  const select = (number: number) => {
    setSection(number)
    setSaved('')
    setReloaded(false)
    answer.reset()
    columns.reset()
    attach.reset()
    detach.reset()
  }
  const jump = (questionId: string) => {
    const target = problem.questions.find((q) => q.id === questionId)
    if (!target) return
    select(target.section)
    // 節を出し直した後に, その問いを見える所に出して入力へ
    window.setTimeout(() => {
      const field = document.getElementById(`field-${questionId}`)
      field?.scrollIntoView({ block: 'center' })
      ;(document.getElementById(`q-${questionId}`) ?? field)?.focus()
    }, 0)
  }
  const closeRename = () => {
    setRenaming(null)
    rename.reset()
  }
  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/">問題の設定</Link>}
        title={problem.name}
        subtitle={`更新 ${formatTime(problem.updated_at)}. 答えた問い ${problem.progress.answered} / ${problem.progress.required}`}
        actions={
          <div className="flex flex-wrap gap-2">
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
              // 押せないのは骨組みを組めないときだけ (直すところは押した後に確かめる)
              disabled={!problem.exportable}
              aria-describedby={
                !problem.exportable || problem.open_errors.length > 0 ? 'export-reason' : undefined
              }
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
          </div>
        }
      />
      {!problem.exportable && !problem.finished && (
        <p id="export-reason" className="-mt-4 mb-4 text-xs text-ink-3">
          {problem.export_error
            ? `学習のプロジェクトはまだ書き出せません. ${withPeriod(problem.export_error)}`
            : '学習のプロジェクトは, 機械学習を使うと決めて骨組みを組める答えがそろうと書き出せます.'}
          {problem.ready && ' 後ろの段階に渡す値は「後ろの段階に渡す値」の欄で見られます.'}
        </p>
      )}
      {problem.exportable && problem.open_errors.length > 0 && (
        <p id="export-reason" className="-mt-4 mb-4 text-xs text-ink-3">
          直すところが {problem.open_errors.length} 件残っています. 書き出すときに一覧を確かめ,
          それでも書き出すかを選べます.
        </p>
      )}
      {formatVersion !== undefined &&
        problem.file_version !== null &&
        problem.file_version < formatVersion && (
          <p
            role="note"
            className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs"
          >
            版 {problem.file_version} の問題の設定のファイルです. 今の版 ({formatVersion})
            に移して開いています. 次にこの問題の設定を変えると (答え, 名前, データ), 版{' '}
            {formatVersion} で書きます.
          </p>
        )}
      {renaming !== null && (
        <form
          className="mb-4 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (renaming.trim()) rename.mutate(renaming.trim())
          }}
          onKeyDown={(event) => event.key === 'Escape' && closeRename()}
        >
          <label htmlFor="rename" className="text-sm">
            新しい名前
          </label>
          <input
            id="rename"
            value={renaming}
            maxLength={80}
            autoFocus
            onChange={(event) => setRenaming(event.target.value)}
            className="h-8 w-80 max-w-full rounded-lg border border-line bg-surface px-2 text-sm"
          />
          <Button type="submit" variant="primary" disabled={!renaming.trim() || rename.isPending}>
            変える
          </Button>
          <Button variant="ghost" onClick={closeRename}>
            やめる
          </Button>
          {rename.error && <ErrorBox error={rename.error} />}
        </form>
      )}
      {problem.finished && (
        <div className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
          機械学習を使わないと決めて終えました. 後ろの段階に渡すものはありません (5
          の「機械学習を使いますか」を変えると続けられます).
        </div>
      )}
      <RequiresCard requires={problem.requires} />
      <div className="grid gap-6 xl:grid-cols-[14rem_minmax(0,1fr)_24rem]">
        <SectionList problem={problem} current={section} onSelect={select} />
        <Card
          title={`${section}. ${title}`}
          actions={
            <div className="flex gap-2">
              <Button disabled={section <= 1} onClick={() => select(section - 1)}>
                前の節
              </Button>
              <Button disabled={section >= 10} onClick={() => select(section + 1)}>
                次の節
              </Button>
            </div>
          }
        >
          {columns.error && <ErrorBox error={columns.error} />}
          {attach.error && <ErrorBox error={attach.error} />}
          {detach.error && <ErrorBox error={detach.error} />}
          {insight.isFetching && (
            <p role="status" className="mb-2 text-xs text-ink-3">
              入れたデータから答えの候補を出しています…
            </p>
          )}
          {here.length === 0 && (
            <p className="text-sm text-ink-3">
              {problem.uses_ml === false
                ? '機械学習を使わないので, この節の問いはありません.'
                : problem.uses_ml === null
                  ? '5 の「機械学習を使いますか」に答えると, この節の問いが出ます.'
                  : 'この節の問いは, 前の節の答え (タスクなど) で要らなくなりました.'}
            </p>
          )}
          {/* 書きかけが節を移っても消えないように, 全ての節の問いを置いて今の節だけを見せる */}
          {visible.map((question) => (
            <div key={question.id} hidden={question.section !== section}>
              <QuestionField
                question={question}
                columns={columnNames}
                findings={joinFindings(problem.findings, insight.data?.findings ?? []).filter(
                  // 手元のデータの項目そのものと元の場所の誤りも, 手元のデータの欄に出す
                  (f) => findingQuestion(problem, f.id)?.id === question.id,
                )}
                saving={
                  savingId === question.id ||
                  (question.id === 'information.columns' && columns.isPending) ||
                  (question.id === 'data.source' && (attach.isPending || detach.isPending))
                }
                suggestion={
                  insight.isFetching
                    ? undefined
                    : insight.data?.suggestions.find((s) => s.id === question.id)
                }
                overview={question.id === 'data.source' ? insight.data?.overview : undefined}
                onAttach={question.id === 'data.source' ? (path) => attach.mutate(path) : undefined}
                onDetach={question.id === 'data.source' ? () => detach.mutate() : undefined}
                error={failedId === question.id ? (answer.error?.message ?? null) : null}
                onAnswer={(value) => answer.mutate({ question: question.id, value })}
                onReadColumns={
                  question.id === 'information.columns' ? (path) => columns.mutate(path) : undefined
                }
              />
              {question.id === 'action.decision' && (
                <SensitivityPanel
                  problemId={id}
                  question={question}
                  fields={info.data?.sensitivity_fields}
                />
              )}
            </div>
          ))}
          <p role="status" aria-live="polite" className="mt-2 text-xs text-ink-3">
            {saved && !answer.isPending && !columns.isPending ? `「${saved}」を保存しました` : ''}
          </p>
          <p role="status" aria-live="polite" className="mt-1 text-xs text-warning-text">
            {reloaded
              ? '問題の設定のファイルが他 (ML-Fathom の書き戻しなど) で変わったので, 読み直しました'
              : ''}
          </p>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="課題から行動までの筋道">
            {problem.summary.length === 0 ? (
              <p className="text-sm text-ink-3">答えると, ここに筋道がまとまります.</p>
            ) : (
              <ul aria-label="筋道" className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {problem.summary.map((sentence) => (
                  <li key={sentence} className="whitespace-pre-line">
                    {sentence}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <FindingsCard problem={problem} extra={insight.data?.findings ?? []} onJump={jump} />
          <HandoffCard problem={problem} splits={info.data?.splits} onJump={jump} />
        </div>
      </div>
      {exporting && <ProjectDialog problem={problem} onClose={() => setExporting(false)} />}
    </>
  )
}
