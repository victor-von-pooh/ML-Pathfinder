import clsx from 'clsx'
import { Database, FileSpreadsheet, Plus, Save, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import type { Decision, Finding, Insight, Lever, Question, Suggestion } from '../../api/types'
import { PathPicker } from '../../components/PathPicker'
import { Button } from '../../components/ui'
import { decisionDraft, decisionFields, sameDecision, splitLines, toLevers } from '../../lib/draft'
import { LEVEL_NAMES } from '../../lib/labels'

/** 入力の共通の見た目 */
const INPUT = 'w-full rounded-lg border border-line bg-surface px-2 text-sm'

/**
 * 1 行で答える文の問い (改行の無い名前. Gymnasium の環境の登録名). ML-Quest の問いは文か
 * どうかだけを持つので, 欄の形はここで決める
 */
const ONE_LINE = /^ml\.parts\.\d+\.env_id$/

/** 答えを保存する関数 */
type Answer = (value: unknown) => void

/** 入力に共通の, 保存中と誤りの状態 */
interface InputState {
  question: Question
  onAnswer: Answer
  /** この問いの答えを保存しているか */
  saving: boolean
  /** この問いの保存の誤り (誤りの文の id) */
  errorId?: string
}

/** 保存した答えを文にする (空は空の文字列) */
function savedText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return Array.isArray(value) ? value.join('\n') : String(value)
}

/** 文と数: 欄を離れたか Enter で, 変わっていれば保存 (同じ値は 2 回送らない) */
function TextInput({
  question,
  onAnswer,
  saving,
  errorId,
  multiline,
}: InputState & { multiline: boolean }) {
  const saved = savedText(question.value)
  const [draft, setDraft] = useState(saved)
  const sent = useRef(saved)
  const commit = () => {
    if (draft.trim() === sent.current.trim()) return
    sent.current = draft
    onAnswer(draft.trim() === '' ? null : draft)
  }
  const props = {
    id: `q-${question.id}`,
    value: draft,
    'aria-busy': saving,
    'aria-invalid': !!errorId,
    'aria-describedby': errorId,
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

/**
 * 選択肢とはいかいいえ: 選んだら保存. 選んだ値をすぐ出し, 保存に失敗したら保存した値に戻す.
 * 保存した答えが今の選択肢 (受け持ちなどで絞られる) に無ければ, 印を付けて出す.
 * 任意の問いは答えを外して空に戻せる
 */
function ChoiceInput({ question, onAnswer, errorId, saving }: InputState) {
  const saved =
    question.value === null || question.value === undefined ? '' : String(question.value)
  const offered =
    question.kind === 'boolean'
      ? [
          { value: 'true', label: 'はい' },
          { value: 'false', label: 'いいえ' },
        ]
      : question.choices
  const stale = saved !== '' && !offered.some((choice) => choice.value === saved)
  const choices = stale
    ? [...offered, { value: saved, label: `${saved} (今の答えに合いません. 選び直してください)` }]
    : offered
  // 保存した値が変わったら, 選んだだけの値を捨てる (前の値と比べて描画の中で)
  const [picked, setPicked] = useState<string | null>(null)
  const [base, setBase] = useState(saved)
  if (base !== saved || (errorId && picked !== null)) {
    setBase(saved)
    setPicked(null)
  }
  const current = picked ?? saved
  return (
    <div
      role="radiogroup"
      aria-labelledby={`t-${question.id}`}
      aria-busy={saving}
      className="flex flex-col gap-1"
    >
      {choices.map((choice, index) => (
        <label key={choice.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            id={index === 0 ? `q-${question.id}` : undefined}
            name={question.id}
            value={choice.value}
            checked={current === choice.value}
            onChange={() => {
              setPicked(choice.value)
              onAnswer(question.kind === 'boolean' ? choice.value === 'true' : choice.value)
            }}
          />
          {choice.label}
        </label>
      ))}
      {/* 合わない答えと, 任意の問いの答え (分からなければ空に戻せるように) は外せる */}
      {(stale || (!question.required && saved !== '')) && (
        <button
          type="button"
          disabled={saving}
          aria-describedby={`t-${question.id}`}
          onClick={() => onAnswer(null)}
          className="self-start text-xs text-accent-text underline"
        >
          答えを外す
        </button>
      )}
    </div>
  )
}

/** 列の名前: 使えるデータの列から選ぶ. 列に無い古い答えも印を付けて出し, 外せるようにする */
function ColumnInput({ question, columns, onAnswer, saving }: InputState & { columns: string[] }) {
  if (question.kind === 'column') {
    const value = typeof question.value === 'string' ? question.value : ''
    const stale = value && !columns.includes(value)
    return (
      <select
        id={`q-${question.id}`}
        value={value}
        aria-busy={saving}
        onChange={(event) => onAnswer(event.target.value || null)}
        className={clsx(INPUT, 'h-8 max-w-72')}
      >
        <option value="">選ぶ</option>
        {stale && <option value={value}>{value} (使えるデータの列にありません)</option>}
        {columns.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    )
  }
  const chosen = Array.isArray(question.value)
    ? question.value.filter((v): v is string => typeof v === 'string')
    : []
  const stale = chosen.filter((name) => !columns.includes(name))
  return (
    <fieldset aria-busy={saving} className="flex flex-wrap gap-x-4 gap-y-1">
      <legend className="sr-only">{question.title}</legend>
      {[...columns, ...stale].map((column, index) => (
        <label key={column} className="flex items-center gap-1.5 font-mono text-sm">
          <input
            type="checkbox"
            id={index === 0 ? `q-${question.id}` : undefined}
            checked={chosen.includes(column)}
            onChange={(event) => {
              // 使えるデータの列の順で並べ, 外したものは除く
              const next = event.target.checked
                ? columns.filter((c) => c === column || chosen.includes(c))
                : chosen.filter((c) => c !== column)
              onAnswer(next.length ? next : null)
            }}
          />
          {column}
          {stale.includes(column) && (
            <span className="font-sans text-xs text-critical-text">(列にありません)</span>
          )}
        </label>
      ))}
    </fieldset>
  )
}

/** 列の並び: 1 行に 1 つ書く. 使えるデータの列はファイルから読める */
function ListInput({
  question,
  onAnswer,
  saving,
  errorId,
  onReadColumns,
}: InputState & { onReadColumns?: (path: string) => void }) {
  const saved = savedText(question.value)
  const [draft, setDraft] = useState(saved)
  const sent = useRef(saved)
  const [picking, setPicking] = useState(false)
  const commit = () => {
    if (draft.trim() === sent.current.trim()) return
    sent.current = draft
    const names = splitLines(draft)
    onAnswer(names.length ? names : null)
  }
  return (
    <div className="flex flex-col gap-2">
      <textarea
        id={`q-${question.id}`}
        value={draft}
        rows={Math.min(8, Math.max(3, draft.split('\n').length))}
        aria-busy={saving}
        aria-invalid={!!errorId}
        aria-describedby={errorId}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        placeholder="1 行に 1 つ"
        className={clsx(INPUT, 'py-1.5 font-mono')}
      />
      {onReadColumns && (
        <div>
          <Button icon={FileSpreadsheet} disabled={saving} onClick={() => setPicking(true)}>
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
function LeversInput({ question, onAnswer, saving }: InputState) {
  const saved = toLevers(question.value)
  const [rows, setRows] = useState<Lever[]>(
    saved.length ? saved : [{ cause: '', lever: '', ml: false }],
  )
  const kept = rows
    .map((r) => ({ cause: r.cause.trim(), lever: r.lever.trim(), ml: r.ml }))
    .filter((r) => r.cause || r.lever)
  const dirty = JSON.stringify(kept) !== JSON.stringify(saved)
  const update = (index: number, patch: Partial<Lever>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-sm" aria-labelledby={`t-${question.id}`}>
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
                  id={index === 0 ? `q-${question.id}` : undefined}
                  aria-label={`要因 ${index + 1}`}
                  value={row.cause}
                  onChange={(event) => update(index, { cause: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                />
              </td>
              <td className="pr-2 pb-1">
                <input
                  aria-label={`打てる手 ${index + 1}`}
                  value={row.lever}
                  onChange={(event) => update(index, { lever: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                />
              </td>
              <td className="pb-1 text-center">
                <input
                  type="checkbox"
                  aria-label={`${index + 1} 行目を機械学習で手伝う`}
                  checked={row.ml}
                  onChange={(event) => update(index, { ml: event.target.checked })}
                />
              </td>
              <td className="pb-1">
                <Button
                  variant="ghost"
                  icon={Trash2}
                  aria-label={`${index + 1} 行目を消す`}
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button icon={Plus} onClick={() => setRows([...rows, { cause: '', lever: '', ml: false }])}>
          行を足す
        </Button>
        <Button
          variant="primary"
          icon={Save}
          disabled={saving || !dirty}
          onClick={() => onAnswer(kept.length ? kept : null)}
        >
          保存
        </Button>
        <span role="status" className="self-center text-xs text-warning-text">
          {dirty ? '保存していません' : ''}
        </span>
      </div>
    </div>
  )
}

/** 意思決定: 型を選び, 損得と制約を書いて保存を押す (型を選び直すと消せる) */
function DecisionInput({ question, onAnswer, saving }: InputState) {
  const value = question.value
  const saved =
    value && typeof value === 'object' && !Array.isArray(value) && 'type' in value
      ? (value as Decision)
      : null
  const [kind, setKind] = useState<Decision['type'] | ''>(saved?.type ?? '')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(saved ?? {})
        .filter(([key]) => key !== 'type')
        .map(([key, item]) => [key, String(item)]),
    ),
  )
  const types = question.choices
  const all = types.find((type) => type.value === kind)?.fields ?? []
  const fields = decisionFields(all, values)
  const known = types.some((type) => type.value === kind)
  const draft = kind && known ? decisionDraft(kind, all, values) : null
  // 知らない型は保存できない (選び直すまで, 保存した答えをそのまま残す)
  const dirty = kind && !known ? false : draft ? !sameDecision(draft, saved) : saved !== null
  return (
    <div className="flex flex-col gap-3">
      <select
        id={`q-${question.id}`}
        value={kind}
        onChange={(event) => setKind(event.target.value as Decision['type'] | '')}
        className={clsx(INPUT, 'h-8 max-w-96')}
      >
        <option value="">型を選ぶ (選ばずに保存すると答えを消す)</option>
        {/* 手で書いた知らない型も出す (保存で黙って欄を消さないように) */}
        {kind && !types.some((type) => type.value === kind) && (
          <option value={kind}>{kind} (知らない型)</option>
        )}
        {types.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
      {fields.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={`d-${question.id}-${field.key}`}
                className="mb-1 block text-xs text-ink-2"
              >
                {field.label}
              </label>
              {field.choices ? (
                <select
                  id={`d-${question.id}-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                >
                  <option value="">{field.unset ?? '選ぶ'}</option>
                  {/* 手で書いた知らない値も出す (選び直せるように) */}
                  {values[field.key] &&
                    !field.choices.some((choice) => choice.value === values[field.key]) && (
                      <option value={values[field.key]}>{values[field.key]} (知らない値)</option>
                    )}
                  {field.choices.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`d-${question.id}-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
                  className={clsx(INPUT, 'h-8')}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          icon={Save}
          disabled={saving || !dirty}
          onClick={() => onAnswer(draft)}
        >
          保存
        </Button>
        {dirty && <span className="self-center text-xs text-warning-text">保存していません</span>}
      </div>
    </div>
  )
}

/**
 * 手元のデータ: 場所を選んで入れる (問題の設定の置き場に写し, 場所と読み方を持つ). 表のファイルか,
 * ML-EDA の版 2 のデータセットのディレクトリ (概要は無く, 件数などは確かめに出る)
 */
function SourceInput({
  question,
  saving,
  overview,
  onAttach,
  onDetach,
}: InputState & {
  overview: Insight['overview'] | undefined
  onAttach?: (path: string) => void
  onDetach?: () => void
}) {
  const [picking, setPicking] = useState(false)
  const value = typeof question.value === 'string' ? question.value : ''
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span id={`q-${question.id}`} tabIndex={-1} className="font-mono text-sm break-all">
          {value || '入れていません'}
        </span>
        {onAttach && (
          <Button icon={Database} disabled={saving} onClick={() => setPicking(true)}>
            {value ? 'データを入れ直す' : 'データを入れる'}
          </Button>
        )}
        {value && onDetach && (
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() =>
              window.confirm(
                'データを外しますか? (置き場の写しを消します. 元のデータのファイルは変わりません)',
              ) && onDetach()
            }
          >
            データを外す
          </Button>
        )}
      </div>
      {overview && (
        <p className="text-xs text-ink-2">
          {overview.rows.toLocaleString()} 行, {overview.columns} 列 (
          {overview.kind === 'timeseries' ? '時系列' : '表'}
          {overview.start && overview.end
            ? `. ${overview.start.slice(0, 10)} から ${overview.end.slice(0, 10)}`
            : ''}
          {overview.sampled && overview.sample_rows
            ? `. 分析は ${overview.sample_rows.toLocaleString()} 行の見本で`
            : ''}
          )
        </p>
      )}
      {picking && onAttach && (
        <PathPicker
          title="手元のデータを選ぶ"
          description="表のファイルか, ML-EDA が書き出したデータセットのディレクトリ (dataset.yaml を持つもの. 画像の領域や点群の予測に使う) を選べます. データの分析の段階 (ML-Fathom) と同じ読み方で読み, 問題の設定の置き場に写します."
          onClose={() => setPicking(false)}
          onPick={(path) => {
            setPicking(false)
            onAttach(path)
          }}
        />
      )}
    </div>
  )
}

/** 今のやり方の書き方の名前 */
const BASELINE_TYPES = {
  lag: 'k 期前と同じ (前の週の同じ曜日なら 7)',
  mean: '直前の k 期の平均',
  column: '今のやり方の値の列 (置いた量, 行動したか)',
} as const

/** 期の数の文字の正規化 ("07" や "7.0" を, 保存した値と同じ "7" に) */
function normalPeriods(text: string): string {
  const trimmed = text.trim()
  const number = Number(trimmed)
  return trimmed !== '' && Number.isFinite(number) ? String(number) : trimmed
}

/** 今のやり方をデータで書く: 種類を選び, 期の数か列を書いて保存を押す */
function BaselineInput({
  question,
  columns,
  onAnswer,
  saving,
  errorId,
}: InputState & { columns: string[] }) {
  const value = question.value
  const saved =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { type?: string; periods?: number; column?: string })
      : null
  const [kind, setKind] = useState<string>(saved?.type ?? '')
  const [periods, setPeriods] = useState(saved?.periods ? String(saved.periods) : '7')
  const [column, setColumn] = useState(saved?.column ?? '')
  const draft =
    kind === 'column'
      ? { type: kind, column: column.trim() }
      : kind
        ? { type: kind, periods: normalPeriods(periods) }
        : null
  const savedText = JSON.stringify(
    saved
      ? saved.type === 'column'
        ? { type: saved.type, column: saved.column }
        : { type: saved.type, periods: String(saved.periods) }
      : null,
  )
  const dirty = JSON.stringify(draft) !== savedText
  return (
    <div className="flex flex-col gap-2">
      <select
        id={`q-${question.id}`}
        value={kind}
        aria-invalid={!!errorId}
        aria-describedby={errorId}
        onChange={(event) => setKind(event.target.value)}
        className={clsx(INPUT, 'h-8 max-w-96')}
      >
        <option value="">書かない (選ばずに保存すると答えを消す)</option>
        {Object.entries(BASELINE_TYPES).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {(kind === 'lag' || kind === 'mean') && (
        <label className="flex items-center gap-2 text-sm">
          k (期の数. データの 1 行の間隔で数える)
          <input
            value={periods}
            type="number"
            min={1}
            step={1}
            aria-invalid={!!errorId}
            aria-describedby={errorId}
            onChange={(event) => setPeriods(event.target.value)}
            className={clsx(INPUT, 'h-8 w-24')}
          />
        </label>
      )}
      {kind === 'column' && (
        <label className="flex items-center gap-2 text-sm">
          列
          {columns.length === 0 ? (
            <input
              value={column}
              placeholder="列の名前 (5 の使えるデータの列に答えると選べます)"
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => setColumn(event.target.value)}
              className={clsx(INPUT, 'h-8 w-96')}
            />
          ) : (
            <select
              value={column}
              aria-invalid={!!errorId}
              aria-describedby={errorId}
              onChange={(event) => setColumn(event.target.value)}
              className={clsx(INPUT, 'h-8 max-w-72')}
            >
              <option value="">選ぶ</option>
              {column && !columns.includes(column) && (
                <option value={column}>{column} (列にありません)</option>
              )}
              {columns.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </label>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          icon={Save}
          disabled={
            saving ||
            !dirty ||
            (kind === 'column' && !column.trim()) ||
            ((kind === 'lag' || kind === 'mean') && !/^[1-9][0-9]*$/.test(normalPeriods(periods)))
          }
          onClick={() => onAnswer(draft)}
        >
          保存
        </Button>
        {dirty && <span className="self-center text-xs text-warning-text">保存していません</span>}
      </div>
    </div>
  )
}

/** データからの答えの候補 (押すと答える. 列の並びの問いは今の答えに足す) */
function Suggestions({
  question,
  suggestion,
  onAnswer,
  saving,
}: {
  question: Question
  suggestion: Suggestion
  onAnswer: Answer
  saving: boolean
}) {
  const many = question.kind === 'columns'
  const current = Array.isArray(question.value)
    ? question.value.filter((v): v is string => typeof v === 'string')
    : []
  const pick = (value: string) => onAnswer(many ? Array.from(new Set([...current, value])) : value)
  // 選択肢の問い (タスクなど) は, 値でなく選択肢の名前で出す
  const labelOf = (value: string) =>
    question.choices.find((c) => c.value === value)?.label.split(' (')[0] ?? value
  const labelId = `s-${question.id}`
  return (
    <div className="mt-2 rounded-lg border border-dashed border-line px-3 py-2">
      <p id={labelId} className="mb-1 text-xs text-ink-2">
        データからの候補: <span className="text-ink-3">{suggestion.reason}</span>
      </p>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {suggestion.values.map((value) => {
          const chosen = many
            ? current.includes(value)
            : question.value != null &&
              typeof question.value !== 'object' &&
              String(question.value) === value
          return (
            <button
              key={value}
              type="button"
              disabled={saving}
              aria-disabled={chosen}
              onClick={() => !chosen && pick(value)}
              className={clsx(
                'rounded-full border px-2.5 py-0.5 font-mono text-xs',
                chosen
                  ? 'border-accent bg-accent-soft text-accent-text'
                  : 'border-line hover:bg-surface-2',
              )}
            >
              {labelOf(value)}
              {chosen ? ' (答えた)' : ''}
            </button>
          )
        })}
        {many && suggestion.values.some((v) => !current.includes(v)) && (
          <button
            type="button"
            disabled={saving}
            onClick={() => onAnswer(Array.from(new Set([...current, ...suggestion.values])))}
            className="rounded-full px-2.5 py-0.5 text-xs text-accent-text underline"
          >
            全て入れる
          </button>
        )}
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

/** 1 つの問い (題, 説明, 入力, 保存の誤り, この問いの確かめ) */
export function QuestionField({
  question,
  columns,
  findings,
  saving,
  error,
  onAnswer,
  onReadColumns,
  suggestion,
  overview,
  onAttach,
  onDetach,
}: {
  question: Question
  columns: string[]
  findings: Finding[]
  saving: boolean
  error: string | null
  onAnswer: Answer
  onReadColumns?: (path: string) => void
  suggestion?: Suggestion
  overview?: Insight['overview']
  onAttach?: (path: string) => void
  onDetach?: () => void
}) {
  // 保存した答えが変わったら書きかけの入力を作り直す. 列から選ぶ問いは, 使える列が
  // 変わったときも作り直す
  const usesColumns = question.kind === 'column' || question.kind === 'columns'
  const key = JSON.stringify([question.id, question.value, usesColumns ? columns : null])
  const errorId = error ? `e-${question.id}` : undefined
  const state: InputState = { question, onAnswer, saving, errorId }
  let input: ReactNode
  if (question.kind === 'text' || question.kind === 'number')
    input = (
      <TextInput
        key={key}
        {...state}
        multiline={question.kind === 'text' && !ONE_LINE.test(question.id)}
      />
    )
  else if (question.kind === 'choice' || question.kind === 'boolean')
    input = <ChoiceInput {...state} />
  else if (usesColumns && columns.length)
    input = <ColumnInput key={key} {...state} columns={columns} />
  else if (question.kind === 'column') input = <TextInput key={key} {...state} multiline={false} />
  else if (question.kind === 'columns' || question.kind === 'list')
    input = <ListInput key={key} {...state} onReadColumns={onReadColumns} />
  else if (question.kind === 'source')
    input = <SourceInput {...state} overview={overview} onAttach={onAttach} onDetach={onDetach} />
  else if (question.kind === 'baseline')
    input = <BaselineInput key={key} {...state} columns={columns} />
  else if (question.kind === 'levers') input = <LeversInput key={key} {...state} />
  else input = <DecisionInput key={key} {...state} />
  return (
    <div id={`field-${question.id}`} className="border-b border-line py-4 last:border-b-0">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <label id={`t-${question.id}`} htmlFor={`q-${question.id}`} className="font-medium">
          {question.title}
        </label>
        <span className="text-xs text-ink-3">{question.required ? '必須' : '任意'}</span>
        {question.answered && <span className="text-xs text-good-text">答えた</span>}
        {saving && <span className="text-xs text-ink-3">保存しています…</span>}
      </div>
      <p className="mb-2 text-xs text-ink-2">{question.help}</p>
      {usesColumns && !columns.length && (
        <p className="mb-2 text-xs text-ink-3">
          {question.kind === 'columns' ? '1 行に 1 つ書けます. ' : ''}5 の「使えるデータの列は」
          に答えると, 列から選べます.
        </p>
      )}
      {input}
      {suggestion && suggestion.values.length > 0 && (
        <Suggestions
          question={question}
          suggestion={suggestion}
          onAnswer={onAnswer}
          saving={saving}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-critical-text">
          保存できませんでした: {error}
        </p>
      )}
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
