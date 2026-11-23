import { useMutation } from '@tanstack/react-query'
import clsx from 'clsx'
import { ChevronDown, ChevronRight, Play } from 'lucide-react'
import { useId, useState } from 'react'

import { api } from '../../api/client'
import type {
  Decision,
  Question,
  Sensitivity,
  SensitivityField,
  SensitivityOutcome,
} from '../../api/types'
import { Button, ErrorBox } from '../../components/ui'
import { bySwing, parseRanges, rangeFields } from '../../lib/sensitivity'

const INPUT = 'w-full rounded-lg border border-line bg-surface px-2 text-sm'

/** 幅の中で求める点の数の選択肢 (両端を含む) */
const POINTS = [3, 5, 7, 9]

/** 決め方の値は小数 4 桁まで, 損は整数で */
function ruleText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 4 })
}

function lossText(value: number | undefined): string {
  if (value === undefined) return '—'
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })
}

function limitText(value: number | null | undefined): string {
  return value === null || value === undefined ? '無し' : `${value.toLocaleString('ja-JP')} 件`
}

function actsText(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value ? '選ぶ' : 'どれも選ばない'
}

/** 今のやり方の損 (時刻の列があれば 30 日あたり) */
function lossOf(point: SensitivityOutcome): number | undefined {
  return point.per_30_days ? point.per_30_days.current : point.loss?.current
}

/** 1 つの項目を変えたときの結論の表 */
function FieldTable({
  result,
  field,
  lead,
}: {
  result: Sensitivity
  field: SensitivityField
  lead: boolean
}) {
  const withLimit = result.type !== 'quantity'
  const withActs = result.type === 'select'
  const withLoss = field.points.some((point) => point.loss !== undefined)
  const monthly = field.points.some((point) => point.per_30_days)
  const withBest = result.type === 'triage' && field.points.some((point) => point.best)
  return (
    <section aria-label={`${field.label}の幅`} className="flex flex-col gap-1">
      <h4 className="flex flex-wrap items-baseline gap-2 text-sm font-medium">
        {field.label}
        {lead && (
          <span className="rounded bg-accent-soft px-1.5 text-xs text-accent-text">決め手</span>
        )}
        <span className="text-xs font-normal text-ink-3">
          振れ幅: {result.rule} {ruleText(field.swing.rule)}
          {field.swing.loss !== null && `, 今のやり方の損 ${lossText(field.swing.loss)}`}
        </span>
      </h4>
      <p className="text-xs text-ink-2">{field.sentence}</p>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="pr-4 font-normal">値</th>
              <th className="pr-4 font-normal">{result.rule}</th>
              {withLimit && <th className="pr-4 font-normal">件数の上限</th>}
              {withActs && <th className="pr-4 font-normal">選ぶか</th>}
              {withLoss && (
                <th className="pr-4 font-normal">
                  今のやり方の損{monthly ? ' (30 日あたり)' : ''}
                </th>
              )}
              {withBest && <th className="font-normal">最も損の小さいやり方</th>}
            </tr>
          </thead>
          <tbody>
            {field.points.map((point) => (
              <tr key={point.value}>
                <td className="pr-4 tabular-nums">{ruleText(point.value)}</td>
                <td className="pr-4 tabular-nums">{ruleText(point.rule)}</td>
                {withLimit && <td className="pr-4 tabular-nums">{limitText(point.limit)}</td>}
                {withActs && (
                  <td className={clsx('pr-4', point.acts === false && 'text-warning-text')}>
                    {actsText(point.acts)}
                  </td>
                )}
                {withLoss && <td className="pr-4 tabular-nums">{lossText(lossOf(point))}</td>}
                {withBest && <td>{point.best_label ?? point.best ?? '—'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 求めた結論の変わり方 (今の値, 知らせ, 決め手の順の項目) */
function SensitivityResult({ result }: { result: Sensitivity }) {
  const fields = bySwing(result)
  const top = fields[0]
  const leads = top && ((top.swing.loss ?? 0) > 0 || (top.swing.rule ?? 0) > 0)
  return (
    <div className="flex flex-col gap-3" aria-label="値を変えたときの結論">
      <p className="text-xs">
        保存した値では, {result.rule}は {ruleText(result.base.rule)}
        {result.base.limit !== undefined && `, 件数の上限は ${limitText(result.base.limit)}`}
        {result.base.acts === false && ', どの対象も選ばない'}
        {result.data &&
          ` (今のやり方の損は ${result.data.rows.toLocaleString('ja-JP')} 行から求めた)`}
      </p>
      {result.notes.length > 0 && (
        <ul aria-label="知らせ" className="flex list-disc flex-col gap-1 pl-5 text-xs text-ink-2">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {fields.map((field) => (
        <FieldTable
          key={field.field}
          result={result}
          field={field}
          lead={!!leads && field === top && fields.length > 1}
        />
      ))}
    </div>
  )
}

/**
 * 損得の値を決める手伝い: 損得と制約の項目ごとに幅を書き, 値を 1 つずつ変えたときの決め方の値と
 * 件数の上限 (と, データの上の今のやり方の損) を見せる. データを読むので重く, 開いて求めるとき
 * だけ呼ぶ. 求めるのは保存した値から
 */
export function SensitivityPanel({
  problemId,
  question,
  fields,
}: {
  problemId: string
  question: Question
  /** 意思決定の型ごとの, 幅を渡せる項目 (/api/info の sensitivity_fields) */
  fields: Record<string, string[]> | undefined
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [ranges, setRanges] = useState<Record<string, { low: string; high: string }>>({})
  const [points, setPoints] = useState(5)
  const [invalid, setInvalid] = useState<string | null>(null)
  // 求めた元の保存した値 (値が変われば古い結果を見せない)
  const saved = JSON.stringify(question.value)
  const run = useMutation({
    mutationFn: (args: {
      parsed: Record<string, [number, number]>
      points: number
      basis: string
    }) => api.sensitivity(problemId, args.parsed, args.points),
  })
  const value = question.value
  const decision =
    value && typeof value === 'object' && !Array.isArray(value) && 'type' in value
      ? (value as Decision)
      : null
  const names = decision ? fields?.[decision.type] : undefined
  if (!decision || !names) return null
  const usable = rangeFields(decision, names)
  // 欄の名前の後ろの補足 (括弧の中) を除いた短い名前
  const labels = Object.fromEntries(
    (question.choices.find((choice) => choice.value === decision.type)?.fields ?? []).map(
      (field) => [field.key, field.label.replace(/\s*\(.*\)$/, '')],
    ),
  )
  const stale = run.variables !== undefined && run.variables.basis !== saved
  const submit = () => {
    // 今は出していない項目 (型を変えた前の書きかけ) は送らない
    const shown = Object.fromEntries(
      Object.entries(ranges).filter(([field]) => usable.includes(field)),
    )
    const parsed = parseRanges(shown, labels)
    if (typeof parsed === 'string') {
      setInvalid(parsed)
      run.reset()
      return
    }
    setInvalid(null)
    run.mutate({ parsed, points, basis: saved })
  }
  const panel = `${id}-panel`
  return (
    <div className="mt-3 rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent"
      >
        {open ? (
          <ChevronDown className="size-4" aria-hidden />
        ) : (
          <ChevronRight className="size-4" aria-hidden />
        )}
        値を決める手伝い
      </button>
      {open && (
        <div id={panel} className="flex flex-col gap-3 border-t border-line p-3">
          <p className="text-xs text-ink-2">
            値に自信の無い項目に幅を書くと, 値を 1 つずつ幅の中で変えたときの決め方の値と件数の上限
            (データと今のやり方があれば, データの上の今のやり方の損) を求めます.
            他の値は保存した値のまま. 行動の件数と量そのものは予測が要るので出しません.
          </p>
          {usable.length === 0 ? (
            <p className="text-xs text-ink-3">
              幅を渡せる項目がありません (列で書いた値は行ごとの値なので幅を渡せません).
            </p>
          ) : (
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="pr-2 font-normal">項目</th>
                  <th className="pr-2 font-normal">保存した値</th>
                  <th className="pr-2 font-normal">下</th>
                  <th className="font-normal">上</th>
                </tr>
              </thead>
              <tbody>
                {usable.map((field) => {
                  const label = labels[field] ?? field
                  const range = ranges[field] ?? { low: '', high: '' }
                  const update = (side: 'low' | 'high', text: string) =>
                    setRanges({ ...ranges, [field]: { ...range, [side]: text } })
                  return (
                    <tr key={field}>
                      <td className="pr-2 pb-1 text-xs">{label}</td>
                      <td className="pr-2 pb-1 text-xs tabular-nums text-ink-2">
                        {decision[field] ?? '—'}
                      </td>
                      <td className="pr-2 pb-1">
                        <input
                          aria-label={`${label}の下`}
                          inputMode="decimal"
                          value={range.low}
                          onChange={(event) => update('low', event.target.value)}
                          className={clsx(INPUT, 'h-8 max-w-32')}
                        />
                      </td>
                      <td className="pb-1">
                        <input
                          aria-label={`${label}の上`}
                          inputMode="decimal"
                          value={range.high}
                          onChange={(event) => update('high', event.target.value)}
                          className={clsx(INPUT, 'h-8 max-w-32')}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {usable.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-points`} className="text-xs text-ink-2">
                点の数 (両端を含む)
              </label>
              <select
                id={`${id}-points`}
                value={points}
                onChange={(event) => setPoints(Number(event.target.value))}
                className={clsx(INPUT, 'h-8 max-w-20')}
              >
                {POINTS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
              <Button icon={Play} disabled={run.isPending} onClick={submit}>
                求める
              </Button>
              {run.isPending && (
                <span role="status" className="text-xs text-ink-3">
                  データを読んで求めています…
                </span>
              )}
            </div>
          )}
          {invalid && (
            <p role="alert" className="text-xs text-critical-text">
              {invalid}
            </p>
          )}
          {run.error && !stale && <ErrorBox error={run.error} />}
          {stale && run.data && (
            <p className="text-xs text-warning-text">
              保存した値が変わりました. もう一度求めてください.
            </p>
          )}
          {run.data && !stale && <SensitivityResult result={run.data} />}
        </div>
      )}
    </div>
  )
}
