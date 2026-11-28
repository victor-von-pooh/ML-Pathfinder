import { ExternalLink, Wrench } from 'lucide-react'

import type { FeatureRequirement } from '../../api/types'

/** 外の案内として開いてよい URL (http か https だけ) */
function safeUrl(url: string | null): string | null {
  return url !== null && /^https?:\/\//.test(url) ? url : null
}

/** 1 行のコマンド (選んで写せるように) */
function Command({ children }: { children: string }) {
  return (
    <code className="block rounded bg-surface-2 px-2 py-1 font-mono text-xs [overflow-wrap:anywhere] select-all">
      {children}
    </code>
  )
}

/** 要る機能 1 つの, 次の一手 */
function FeatureAction({ item }: { item: FeatureRequirement }) {
  const install = item.install
  const url = safeUrl(install?.url ?? null)
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3">
      <p className="text-sm font-medium">
        {item.label} <span className="font-mono text-xs text-ink-3">({item.name})</span>
      </p>
      {item.description && <p className="text-xs text-ink-2">{item.description}</p>}
      {install?.kind === 'pip' && install.command && (
        <div className="flex flex-col gap-1">
          <p className="text-xs">次の一手: 学習の環境で入れる</p>
          <Command>{install.command}</Command>
          {install.extra_command && (
            <>
              <p className="text-xs text-ink-2">ML-Found に足す依存としても入れられます</p>
              <Command>{install.extra_command}</Command>
            </>
          )}
        </div>
      )}
      {(!install || install.kind === null || (install.kind === 'pip' && !install.command)) && (
        <p className="text-xs">次の一手: 学習を始める前に, 学習の環境に入れる</p>
      )}
      {install?.kind === 'guide' && (
        <p className="text-xs">
          次の一手: pip では入らないので, 公式の手順に従って学習の環境に入れる
        </p>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 self-start text-xs text-accent-text underline"
        >
          {install?.kind === 'guide' ? '公式の手順' : '説明'}
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">(新しいタブで開く)</span>
        </a>
      )}
      {item.note && <p className="text-xs text-ink-2">{item.note}</p>}
    </li>
  )
}

/**
 * 答えから要る機能を, 学習・評価の段階の準備として早めに知らせる (この画面では何も止めない).
 * pip で入らない道具は要るまで入れないので, 入れ方のコマンドか案内を添える
 */
export function RequiresCard({ requires }: { requires: FeatureRequirement[] }) {
  if (requires.length === 0) return null
  return (
    <section
      aria-labelledby="requires-title"
      className="mb-4 rounded-xl border border-accent/30 bg-accent-soft p-4"
    >
      <h2 id="requires-title" className="flex items-center gap-1.5 text-sm font-semibold">
        <Wrench className="size-4" aria-hidden />
        学習・評価の段階の準備: この問題には次の機能が要ります
      </h2>
      <p className="mt-1 mb-3 text-xs text-ink-2">
        今の答えから分かったものです. この段階はこのまま続けられます.
        学習・評価の段階で学習を始める前に, 学習の環境に入れてください.
      </p>
      <ul className="grid gap-3 md:grid-cols-2">
        {requires.map((item) => (
          <FeatureAction key={item.name} item={item} />
        ))}
      </ul>
    </section>
  )
}
