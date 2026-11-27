import clsx from 'clsx'
import { Compass, ListChecks, Moon, Sun } from 'lucide-react'
import { NavLink, Route, Routes } from 'react-router'

import { ProblemPage } from './features/problems/ProblemPage'
import { ProblemsPage } from './features/problems/ProblemsPage'
import { useStage } from './lib/stage'
import { useTheme } from './lib/themeContext'

/** 左の欄の移動先 */
function NavItem({ to, icon: Icon, label }: { to: string; icon: typeof Compass; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
          isActive
            ? 'bg-accent-soft font-medium text-accent-text'
            : 'text-ink-2 hover:bg-surface-2',
        )
      }
    >
      <Icon size={16} aria-hidden />
      {label}
    </NavLink>
  )
}

export function App() {
  const { theme, toggle } = useTheme()
  const { embedded } = useStage()
  return (
    <div className="flex h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        本文へ移る
      </a>
      <nav
        aria-label="移動"
        className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line bg-surface p-3 md:flex"
      >
        {/* 殻の下では名前と明暗の切り替えを殻の上の帯が持つ */}
        {!embedded && (
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="flex items-center gap-2 text-base font-semibold">
              <Compass size={20} className="text-accent" aria-hidden />
              ML-Pathfinder
            </span>
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? '明るい表示にする' : '暗い表示にする'}
              className="rounded p-1 text-ink-3 hover:bg-surface-2"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        )}
        <NavItem to="/" icon={ListChecks} label="問題の設定" />
      </nav>
      <main id="main" className="min-w-0 flex-1 overflow-auto px-4 py-4 md:px-8 md:py-6">
        {/* 狭い画面では左の欄の代わりに, 上に名前と一覧への移動 (殻の下では一覧への移動だけ) */}
        {embedded ? (
          <div className="mb-4 md:hidden">
            <NavLink
              to="/"
              className="flex items-center gap-2 text-sm font-medium text-accent-text"
            >
              <ListChecks size={16} aria-hidden />
              問題の設定
            </NavLink>
          </div>
        ) : (
          <div className="mb-4 flex items-center justify-between md:hidden">
            <NavLink to="/" className="flex items-center gap-2 font-semibold">
              <Compass size={18} className="text-accent" aria-hidden />
              ML-Pathfinder
            </NavLink>
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? '明るい表示にする' : '暗い表示にする'}
              className="rounded p-1 text-ink-3 hover:bg-surface-2"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<ProblemsPage />} />
          <Route path="/problems/:id" element={<ProblemPage />} />
          <Route path="*" element={<p className="text-ink-3">ページが見つかりません.</p>} />
        </Routes>
      </main>
    </div>
  )
}
