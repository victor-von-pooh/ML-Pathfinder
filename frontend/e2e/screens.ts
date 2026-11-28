/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// README の画面の例 (docs/images/*.png) を撮る (CI では使わない).
// 先に pnpm build をして, 別の端末で bash e2e/screens.sh を起動しておき,
// frontend で node e2e/screens.ts を実行する
import { resolve } from 'node:path'

import { chromium, expect, type Page } from '@playwright/test'

const port = Number(process.env.SCREENS_PORT ?? 8796)
const base = `http://127.0.0.1:${port}`
const home = resolve('e2e/.screens/home')
const out = resolve('../docs/images')

/** 画面に出る作り物のホームの場所を ~ で示す (手元の場所を写さない) */
function hideHome(prefix: string) {
  const swap = (text: string) => text.split(prefix).join('~')
  const run = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.nodeValue?.includes(prefix)) node.nodeValue = swap(node.nodeValue)
    for (const input of document.querySelectorAll('input'))
      if (input.value.includes(prefix)) input.value = swap(input.value)
  }
  document.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(run).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })
    setInterval(run, 100)
  })
}

async function choose(page: Page, title: string, label: string | RegExp) {
  await page.getByRole('radiogroup', { name: title, exact: true }).getByLabel(label).check()
  await expect(page.getByText(`「${title}」を保存しました`)).toBeVisible()
}

async function write(page: Page, title: string, text: string) {
  const box = page.getByRole('textbox', { name: title, exact: true })
  await box.fill(text)
  await box.blur()
  await expect(page.getByText(`「${title}」を保存しました`)).toBeVisible()
}

async function section(page: Page, n: number) {
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: new RegExp(`^${n}\\b`) })
    .click()
}

async function shot(page: Page, name: string) {
  // 保存の知らせが消え, 場所の置き換えが済むのを待つ
  await page.waitForTimeout(4500)
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `${out}/${name}.png` })
}

async function create(page: Page, name: string) {
  await page.goto('/')
  await page.getByLabel(/問題の名前/).fill(name)
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

async function openSample(page: Page, name: string) {
  await page.goto('/')
  await page.getByRole('button', { name }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/** ホームの下のディレクトリを選ぶ対話で, 1 つを選んで入れる */
async function pick(page: Page, entry: RegExp) {
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const picker = page.getByRole('dialog')
  await picker.getByLabel('パス').fill('~')
  await picker.getByRole('button', { name: '移動' }).click()
  await picker.getByRole('button', { name: entry }).click()
  await picker.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(picker).toHaveCount(0)
}

async function answerApi(page: Page, answers: [string, unknown][]) {
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  for (const [key, value] of answers) {
    const response = await page.request.put(`/api/problems/${id}/answers`, {
      data: { id: key, value },
    })
    if (!response.ok()) throw new Error(`${key}: ${response.status()}`)
  }
  await page.reload()
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  baseURL: base,
  viewport: { width: 1600, height: 900 },
  colorScheme: 'light',
})
await context.addInitScript(hideHome, home)
const page = await context.newPage()
await page.goto('/api/auth?token=screens-token')

// 見本 2 つと, 画面で答える問題 (売れる数の予測, 腕の制御, 撮影から形の点群)
await openSample(page, '解約の引き止め')
await section(page, 7)
await shot(page, 'decision')

await openSample(page, '総菜の作る量')
await shot(page, 'problem')
await section(page, 5)
await page.getByRole('radio', { name: /分類/ }).check()
await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
  '量を決めるには',
)
await page
  .getByRole('list', { name: '確かめ', exact: true })
  .evaluate((list) => list.scrollIntoView({ block: 'center' }))
await shot(page, 'conflict')
await page.getByRole('radio', { name: /時系列の予測/ }).check()
await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()
await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
const dialog = page.getByRole('dialog')
await dialog.getByLabel('書き出すディレクトリ (無ければ作る)').fill('~/projects/souzai')
await dialog.getByRole('button', { name: '書き出す' }).click()
await expect(dialog.getByRole('status')).toContainText('train.py')
await shot(page, 'export')
await page.keyboard.press('Escape')

await create(page, '売れる数の予測')
await section(page, 5)
await choose(page, '機械学習を使いますか', 'はい')
await choose(page, '機械学習は何を受け持ちますか', /^予測する/)
await choose(page, '正解 (出力) の種類は', /^表の列/)
await pick(page, /^sales\.csv/)
await expect(page.getByText(/240 行, 7 列/)).toBeVisible()
await choose(page, 'どの種類の問題ですか', /^時系列の予測/)
await page.getByText('データからの候補').first().scrollIntoViewIfNeeded()
await shot(page, 'data_candidates')

await create(page, '腕の制御')
await section(page, 5)
await choose(page, '機械学習を使いますか', 'はい')
await choose(page, '機械学習は何を受け持ちますか', /^効果を見積もる/)
await choose(page, '機械学習が, 続けて自分で行動を選びますか (方策)', 'はい')
await choose(page, '行動の結果のデータは, どう集めますか', /^シミュレータで試して集める/)
await choose(page, 'どのシミュレータを使いますか', /^MuJoCo/)
await write(page, 'Gymnasium の環境の登録名は (あれば)', 'Hopper-v5')
await page.getByRole('heading', { name: /学習・評価の段階の準備/ }).scrollIntoViewIfNeeded()
await shot(page, 'policy')

await create(page, '撮影から形の点群')
await answerApi(page, [
  ['issue.owner', '設計の係'],
  ['issue.pain', '形の計算に時間がかかる'],
  ['issue.current', '毎回計算する'],
  ['issue.kpi.name', '待ち時間'],
  ['issue.kpi.unit', '分'],
  ['issue.kpi.better', 'lower'],
  ['decomposition', [{ cause: '毎回計算する', lever: '近似で省く', ml: true }]],
  ['action.who', '設計の係'],
  ['action.when', '計算の前'],
  ['action.what', '計算を省くか'],
  ['ml.reason', '計算の結果を早く近似したい'],
  ['verification.method', 'backtest'],
  ['verification.backtest', '過去の結果と比べる'],
  ['verification.success', '待ち時間が半分'],
  ['operation.review', '月に 1 回'],
  ['operation.approver', '係の長'],
  ['operation.stop', '外れが増えたら'],
])
await section(page, 5)
await choose(page, '機械学習を使いますか', 'はい')
await choose(page, '機械学習は何を受け持ちますか', /^予測する/)
await choose(page, '1 件の単位は', /^まとまり/)
await choose(page, '出力の形は', /^3D の形/)
await choose(page, '正解は誰が, いつ, どう確定させますか (正解の出どころ)', /^今の処理の出力/)
await write(page, '正解を作る今の処理の名前は', '今の計算')
await choose(page, 'どう作りますか (作り方)', /^一から学習/)
await choose(page, '正解 (出力) の種類は', /^点群/)
await write(page, '何を出させますか', '形の点群')
await write(page, '1 件は何ですか', '1 回の撮影')
await write(page, '機械学習を使わない比べる相手は', '今の計算')
await pick(page, /^clouds\s*データセット$/)
await expect(page.getByRole('list', { name: '手元のデータは の確かめ' })).toContainText(
  'ML-EDA の版 2 のデータセット',
  { timeout: 20_000 },
)
await section(page, 8)
await choose(page, '最も良いモデルを何で選びますか', /Chamfer/)
await page
  .getByRole('heading', { name: '後ろの段階に渡す値' })
  .evaluate((heading) => heading.scrollIntoView({ block: 'start' }))
await shot(page, 'point_cloud')

await page.goto('/')
await expect(page.getByRole('list', { name: '問題の一覧' })).toContainText('撮影から形の点群')
await shot(page, 'list')

await browser.close()
