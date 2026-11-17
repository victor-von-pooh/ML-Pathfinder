import clsx from 'clsx'
import { FileSpreadsheet, Plus, Save, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { Decision, Finding, Lever, Question } from '../../api/types'
import { PathPicker } from '../../components/PathPicker'
import { Button } from '../../components/ui'
import { decisionDraft, sameDecision, splitLines } from '../../lib/draft'
import { DECISION_FIELDS, DECISION_NAMES, LEVEL_NAMES } from '../../lib/labels'

/** 入力の共通の見た目 */
const INPUT = 'w-full rounded-lg border border-line bg-surface px-2 text-sm'

/** 答えを保存する関数 (保存できたかを返す) */
type Answer = (value: unknown) => void

/** 文と数: 欄を離れたときに, 変わっていれば保存 */
function TextInput({
  question,
  onAnswer,
  busy,
  multiline,
}: {
  question: Question
  onAnswer: Answer
  busy: boolean
  multiline: boolean
}) {
  const saved =
    question.value === null || question.value === undefined ? '' : String(question.value)
  const [draft, setDraft] = useState(saved)
  const commit = () => {
    if (draft.trim() !== saved.trim()) onAnswer(draft.trim() === '' ? null : draft)
  }
  const props = {
    id: `q-${question.id}`,
    value: draft,
    disabled: busy,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onBlur: commit,
  }
  return multiline ? (
    <textarea {...props} rows={2} className={clsx(INPUT, 'py-1.5')} />
  ) : (
    <input
      {...props}
      inputMode={question.kind === 'number' ? 'decimal' : undefined}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
      className={clsx(INPUT, 'h-8', question.kind === 'number' && 'max-w-48')}
    />
  )
}

/** 選択肢とはいかいいえ: 選んだら保存 */
function ChoiceInput({
  question,
  onAnswer,
  busy,
}: {
  question: Question
  onAnswer: Answer
  busy: boolean
}) {
  const choices =
    question.kind === 'boolean'
      ? [
          { value: 'true', label: 'はい' },
          { value: 'false', label: 'いいえ' },
        ]
      : question.choices
  // 選んだら保存を待たずに選んだ形にする (保存の結果で作り直す)
  const [current, setCurrent] = useState(
    question.value === null || question.value === undefined ? '' : String(question.value),
  )
  return (
    <div role="radiogroup" aria-labelledby={`t-${question.id}`} className="flex flex-col gap-1">
      {choices.map((choice) => (
        <label key={choice.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={question.id}
            value={choice.value}
            checked={current === choice.value}
            disabled={busy}
            onChange={() => {
              setCurrent(choice.value)
              onAnswer(question.kind === 'boolean' ? choice.value === 'true' : choice.value)
            }}
          />
          {choice.label}
        </label>
      ))}
    </div>
  )
}

/** 列の名前: 使えるデータの列があれば選び, 無ければ書く */
function ColumnInput({
  question,
  columns,
  onAnswer,
  busy,
}: {
  question: Question
  columns: string[]
  onAnswer: Answer
  busy: boolean
}) {
  if (!columns.length)
    return (
      <>
        <TextInput question={question} onAnswer={onAnswer} busy={busy} multiline={false} />
        <p className="mt-1 text-xs text-ink-3">
          先に「使えるデータの列は」を答えると, 列から選べます.
        </p>
      </>
    )
  if (question.kind === 'column')
    return (
      <select
        id={`q-${question.id}`}
        value={typeof question.value === 'string' ? question.value : ''}
        disabled={busy}
        onChange={(event) => onAnswer(event.target.value || null)}
        className={clsx(INPUT, 'h-8 max-w-72')}
      >
        <option value="">選ぶ</option>
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    )
  const chosen = Array.isArray(question.value) ? (question.value as string[]) : []
  return (
    <fieldset aria-labelledby={`t-${question.id}`} className="flex flex-wrap gap-x-4 gap-y-1">
      {columns.map((column) => (
        <label key={column} className="flex items-center gap-1.5 font-mono text-sm">
          <input
            type="checkbox"
            checked={chosen.includes(column)}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.checked
                ? columns.filter((c) => c === column || chosen.includes(c))
                : chosen.filter((c) => c !== column)
              onAnswer(next.length ? next : null)
            }}
          />
          {column}
        </label>
      ))}
    </fieldset>
  )
}

/** 使えるデータの列: 1 行に 1 つ書くか, ファイルから読む */
function ListInput({
  question,
  onAnswer,
  onReadColumns,
  busy,
}: {
  question: Question
  onAnswer: Answer
  onReadColumns?: (path: string) => void
  busy: boolean
}) {
  const saved = Array.isArray(question.value) ? (question.value as string[]).join('\n') : ''
  const [draft, setDraft] = useState(saved)
  const [picking, setPicking] = useState(false)
  const commit = () => {
    if (draft.trim() === saved.trim()) return
    const names = splitLines(draft)
    onAnswer(names.length ? names : null)
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        id={`q-${question.id}`}
        value={draft}
        rows={Math.min(8, Math.max(3, draft.split('\n').length))}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        placeholder="1 行に 1 つ"
        className={clsx(INPUT, 'py-1.5 font-mono')}
      />
      {onReadColumns && (
        <div>
          <Button icon={FileSpreadsheet} disabled={busy} onClick={() => setPicking(true)}>
            データのファイルから読む
          </Button>
        </div>
      )}
      {picking && onReadColumns && (
        <PathPicker
          title="データのファイルを選ぶ"
          description="csv, tsv, Excel, parquet の先頭の行から列の名前を読みます (中身は読みません)."
          pickDirs={false}
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false)
            onReadColumns(path)
          }}
        />
      )}
    </div>
  )
}

/** 要因と打てる手: 行を足して書き, 保存を押す */
function LeversInput({
  question,
  onAnswer,
  busy,
}: {
  question: Question
  onAnswer: Answer
  busy: boolean
}) {
  const saved = Array.isArray(question.value) ? (question.value as Lever[]) : []
  const [rows, setRows] = useState<Lever[]>(
    saved.length ? saved : [{ cause: '', lever: '', ml: false }],
  )
  const dirty = JSON.stringify(rows.filter((r) => r.cause || r.lever)) !== JSON.stringify(saved)
  const update = (index: number, patch: Partial<Lever>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="pb-1 font-medium">要因</th>
            <th className="pb-1 font-medium">打てる手</th>
            <th className="pb-1 font-medium">機械学習で手伝う</th>
            <th className="sr-only">消す</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <td className="pr-2 pb-1">
                <input
                  aria-label={`要因 ${index + 1}`}
                  value={row.cause}
                  disabled={busy}
                  onChange={(event) => update(index, { cause: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                />
              </td>
              <td className="pr-2 pb-1">
                <input
                  aria-label={`打てる手 ${index + 1}`}
                  value={row.lever}
                  disabled={busy}
                  onChange={(event) => update(index, { lever: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                />
              </td>
              <td className="pb-1 text-center">
                <input
                  type="checkbox"
                  aria-label={`機械学習で手伝う ${index + 1}`}
                  checked={row.ml}
                  disabled={busy}
                  onChange={(event) => update(index, { ml: event.target.checked })}
                />
              </td>
              <td className="pb-1">
                <Button
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`${index + 1} 行目を消す`}
                  disabled={busy || rows.length === 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button
          icon={Plus}
          disabled={busy}
          onClick={() => setRows([...rows, { cause: '', lever: '', ml: false }])}
        >
          行を足す
        </Button>
        <Button
          variant="primary"
          icon={Save}
          disabled={busy || !dirty}
          onClick={() => {
            const kept = rows.filter((r) => r.cause.trim() || r.lever.trim())
            onAnswer(kept.length ? kept : null)
          }}
        >
          保存
        </Button>
        {dirty && <span className="self-center text-xs text-warning-text">保存していません</span>}
      </div>
    </div>
  )
}

/** 意思決定: 型を選び, 損得と制約を書いて保存を押す */
function DecisionInput({
  question,
  onAnswer,
  busy,
}: {
  question: Question
  onAnswer: Answer
  busy: boolean
}) {
  const saved = (question.value as Decision | null) ?? null
  const [kind, setKind] = useState<Decision['type'] | ''>(saved?.type ?? '')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(saved ?? {})
        .filter(([key]) => key !== 'type')
        .map(([key, value]) => [key, String(value)]),
    ),
  )
  const fields = kind ? DECISION_FIELDS[kind] : []
  const draft = kind ? decisionDraft(kind, values) : null
  const dirty = draft !== null && !sameDecision(draft, saved)
  return (
    <div className="flex flex-col gap-3">
      <select
        id={`q-${question.id}`}
        aria-label="意思決定の型"
        value={kind}
        disabled={busy}
        onChange={(event) => setKind(event.target.value as Decision['type'] | '')}
        className={clsx(INPUT, 'h-8 max-w-96')}
      >
        <option value="">型を選ぶ</option>
        {(Object.keys(DECISION_NAMES) as Decision['type'][]).map((type) => (
          <option key={type} value={type}>
            {DECISION_NAMES[type]}
          </option>
        ))}
      </select>
      {fields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key}>
              <label htmlFor={`d-${field.key}`} className="mb-1 block text-xs text-ink-2">
                {field.label}
              </label>
              <input
                id={`d-${field.key}`}
                value={values[field.key] ?? ''}
                disabled={busy}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                className={clsx(INPUT, 'h-8')}
              />
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          icon={Save}
          disabled={busy || !dirty}
          onClick={() => onAnswer(draft)}
        >
          保存
        </Button>
        {dirty && <span className="self-center text-xs text-warning-text">保存していません</span>}
      </div>
    </div>
  )
}

/** 確かめの重さの見た目 */
const LEVEL_STYLE: Record<Finding['level'], string> = {
  error: 'text-critical-text',
  warning: 'text-warning-text',
  info: 'text-ink-2',
}

/** 1 つの問い (題, 説明, 入力, この問いの確かめ) */
export function QuestionField({
  question,
  columns,
  findings,
  busy,
  onAnswer,
  onReadColumns,
}: {
  question: Question
  columns: string[]
  findings: Finding[]
  busy: boolean
  onAnswer: Answer
  onReadColumns?: (path: string) => void
}) {
  // 保存した答えが変わったら入力を作り直す (他の問いの答えで選べる値も変わる)
  const key = `${question.id}:${JSON.stringify(question.value)}:${columns.join(',')}`
  let input: ReactNode
  if (question.kind === 'text' || question.kind === 'number')
    input = (
      <TextInput
        key={key}
        question={question}
        onAnswer={onAnswer}
        busy={busy}
        multiline={question.kind === 'text'}
      />
    )
  else if (question.kind === 'choice' || question.kind === 'boolean')
    input = <ChoiceInput key={key} question={question} onAnswer={onAnswer} busy={busy} />
  else if (question.kind === 'column' || question.kind === 'columns')
    input = (
      <ColumnInput
        key={key}
        question={question}
        columns={columns}
        onAnswer={onAnswer}
        busy={busy}
      />
    )
  else if (question.kind === 'list')
    input = (
      <ListInput
        key={key}
        question={question}
        onAnswer={onAnswer}
        onReadColumns={onReadColumns}
        busy={busy}
      />
    )
  else if (question.kind === 'levers')
    input = <LeversInput key={key} question={question} onAnswer={onAnswer} busy={busy} />
  else input = <DecisionInput key={key} question={question} onAnswer={onAnswer} busy={busy} />
  return (
    <div className="border-b border-line py-4 last:border-b-0">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <label id={`t-${question.id}`} htmlFor={`q-${question.id}`} className="font-medium">
          {question.title}
        </label>
        {question.required ? (
          <span className="text-xs text-ink-3">必須</span>
        ) : (
          <span className="text-xs text-ink-3">任意</span>
        )}
        {question.answered && <span className="text-xs text-good-text">答えた</span>}
      </div>
      <p className="mb-2 text-xs text-ink-2">{question.help}</p>
      {input}
      {findings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-xs" aria-label={`${question.title} の確かめ`}>
          {findings.map((finding) => (
            <li key={finding.message} className={LEVEL_STYLE[finding.level]}>
              {LEVEL_NAMES[finding.level]}: {finding.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
