import { readFileSync, writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

// 作業用の置き場で, 見本を開き, 答えを変えて確かめが変わり, 骨組みを書き出す
test('見本を開いて答えを変え, 学習のプロジェクトを書き出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await expect(page.getByRole('heading', { name: '総菜の作る量' })).toBeVisible()
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()

  // タスクを分類に変えると, 量を決める行動と食い違う
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  await page.getByRole('radio', { name: /分類/ }).check()
  await expect(page.getByRole('list', { name: '確かめ' })).toContainText('量を決めるには')
  await expect(page.getByRole('button', { name: '学習のプロジェクトを書き出す' })).toBeDisabled()

  // 時系列の予測に戻すと書き出せる
  await page.getByRole('radio', { name: /時系列の予測/ }).check()
  await expect(page.getByText('食い違いや足りない答えはありません.')).toBeVisible()
  await page.getByRole('button', { name: '学習のプロジェクトを書き出す' }).click()
  const dialog = page.getByRole('dialog')
  await dialog
    .getByLabel('書き出すディレクトリ (無ければ作る)')
    .fill(`${process.cwd()}/e2e/.work/project`)
  await dialog.getByRole('button', { name: '書き出す' }).click()
  await expect(dialog.getByRole('status')).toContainText('train.py')
})

test('新しく作って課題に答え, 一覧に進み具合が出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('試しの問題')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '試しの問題' })).toBeVisible()
  const pain = page.getByRole('textbox', { name: '何に困っていますか' })
  await pain.fill('問い合わせが多い')
  await pain.blur()
  await expect(page.getByText('保存しました')).toBeVisible()
  await page.getByRole('link', { name: '問題の設定' }).first().click()
  await expect(page.getByRole('list', { name: '問題の設定' })).toContainText('試しの問題')
})

test('書きかけは節を移っても残り, 列の並びは 1 行に 1 つで答えられる', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('書きかけ')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '書きかけ' })).toBeVisible()

  // 3 の分解の書きかけを残して 2 へ移り, 戻る
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByLabel('要因 1').fill('勘で決める')
  await page.getByRole('button', { name: '前の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await expect(page.getByLabel('要因 1')).toHaveValue('勘で決める')

  // 機械学習を使うと, 6 の列の問いが出る. 列の一覧が無くても 1 行に 1 つで答えられる
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('radiogroup', { name: '機械学習を使いますか' }).getByLabel('はい').check()
  await expect(page.getByText('「機械学習を使いますか」を保存しました')).toBeVisible()
  await page.getByRole('button', { name: /^6\./ }).first().click()
  const known = page.getByRole('textbox', { name: '予測の時点で分かっている列は' })
  await known.fill('promo\nweather')
  await known.blur()
  await expect(page.getByText('「予測の時点で分かっている列は」を保存しました')).toBeVisible()
  await expect(known).toHaveValue('promo\nweather')
})

test('確かめから問いへ移ると, その入力に移る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('移る')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await page
    .getByRole('list', { name: '確かめ' })
    .getByRole('button', { name: /解けたと言える指標 の問いへ/ })
    .first()
    .click()
  await expect(page.getByRole('textbox', { name: '何が変われば解けたと言えますか' })).toBeFocused()
})

test('手元のデータを入れると, 答えの候補が出て押すと答えになる', async ({ page }) => {
  // 2 店の 60 日の売上と, 売上から作った客数
  const rows = ['date,shop,sales,customers']
  for (const shop of ['a', 'b'])
    for (let day = 0; day < 60; day++) {
      const date = new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10)
      const sales = 50 + (day % 7) * 10
      rows.push(`${date},${shop},${sales},${sales * 3 + 1}`)
    }
  const file = `${process.cwd()}/e2e/.work/shop.csv`
  writeFileSync(file, rows.join('\n') + '\n')

  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('データ')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^5\b/ })
    .click()
  await page.getByRole('radiogroup', { name: '機械学習を使いますか' }).getByLabel('はい').check()
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('パス').fill(file)
  await dialog.getByRole('button', { name: '移動' }).click()
  await dialog.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(page.getByText('120 行, 4 列')).toBeVisible()

  // 目的の列の候補を押すと答えになり, 漏れの疑いが確かめに出る
  await page.getByRole('button', { name: 'sales', exact: true }).click()
  await expect(page.getByText('「目的の列は」を保存しました')).toBeVisible()
  await page
    .getByRole('navigation', { name: '問いの節' })
    .getByRole('button', { name: /^6\b/ })
    .click()
  await expect(
    page
      .getByRole('list', { name: '確かめ', exact: true })
      .getByText(/customers は目的の列とほぼ同じ動き/),
  ).toBeVisible({ timeout: 20_000 })
})

test('今のやり方をデータで書くと, 損と指標の今の値の候補が出る', async ({ page }) => {
  // 総菜の見本と同じ列の 40 日 × 2 店 × 2 品 (曜日で決まる売れた数)
  const rows = ['date,store,item,sales,temperature_forecast,promo,customers']
  for (let day = 0; day < 40; day++) {
    const date = new Date(Date.UTC(2025, 0, 1 + day))
    for (const store of ['east', 'west'])
      for (const item of ['a', 'b']) {
        const sales = 10 + date.getUTCDay()
        rows.push(`${date.toISOString().slice(0, 10)},${store},${item},${sales},15,0,${sales * 3}`)
      }
  }
  const file = `${process.cwd()}/e2e/.work/sozai.csv`
  writeFileSync(file, rows.join('\n') + '\n')

  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  const nav = page.getByRole('navigation', { name: '問いの節' })
  await nav.getByRole('button', { name: /^5\b/ }).click()
  await page.getByRole('button', { name: 'データを入れる' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('パス').fill(file)
  await dialog.getByRole('button', { name: '移動' }).click()
  await dialog.getByRole('button', { name: '選ぶ', exact: true }).click()
  await expect(page.getByText('160 行, 7 列')).toBeVisible()

  // 7 の節で「1 日前と同じ」と書くと, 曜日の差の分の損が出る
  await nav.getByRole('button', { name: /^7\b/ }).click()
  await page.getByLabel('今のやり方をデータで書くと').selectOption('lag')
  await page.getByLabel(/k \(期の数/).fill('1')
  await page.getByRole('button', { name: '保存' }).last().click()
  await expect(page.getByText(/今のやり方の損は, 39 日で/).first()).toBeVisible({ timeout: 20_000 })

  // 2 の節の指標の今の値に, データからの候補が出る
  await nav.getByRole('button', { name: /^2\b/ }).click()
  await expect(page.getByRole('group', { name: /今のやり方の損をデータで求めた値/ })).toBeVisible()
})

test('問題の設定のファイルが他で変わると, 読み直して変わった問いの入力に出す', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByLabel(/問題の名前/).fill('他で変わる')
  await page.getByRole('button', { name: '作る', exact: true }).click()
  await expect(page.getByRole('heading', { name: '他で変わる' })).toBeVisible()
  const pain = page.getByRole('textbox', { name: '何に困っていますか' })
  await pain.fill('問い合わせが多い')
  await pain.blur()
  await expect(page.getByText('保存しました')).toBeVisible()

  // 別の問いは書きかけ (まだ欄を離れていない)
  const current = page.getByRole('textbox', { name: '今はどうしていますか' })
  await current.fill('前の週と同じ数')

  // 他のアプリ (ML-Fathom の書き戻しなど) がファイルを書き換えたとする
  const id = new URL(page.url()).pathname.split('/').pop() ?? ''
  const file = `${process.cwd()}/e2e/.work/home/problems/${id}/problem.yaml`
  writeFileSync(file, readFileSync(file, 'utf-8').replace('問い合わせが多い', '欠品が多い'))
  await expect(page.getByText(/他 \(ML-Fathom の書き戻しなど\) で変わったので/)).toBeVisible({
    timeout: 15_000,
  })
  await expect(pain).toHaveValue('欠品が多い')
  // 変わっていない問いの書きかけは残る
  await expect(current).toHaveValue('前の週と同じ数')
})

test('対象を選ぶ効果を確率の差で書くと, 向きの欄が出て, 保存すると食い違いが無い', async ({
  page,
}) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '解約の引き止め' }).click()
  await page.getByRole('button', { name: /損得と制約/ }).click()
  await expect(page.getByLabel(/当たりをどうしたいか/)).toHaveCount(0)
  await page.getByLabel(/効果の渡し方/).selectOption('uplift')
  await page.getByLabel(/^効果 \(/).fill('-0.1')
  await page.getByRole('button', { name: '保存' }).first().click()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    '向き (effect_goal',
  )
  await page.getByLabel(/当たりをどうしたいか/).selectOption('reduce')
  await page.getByRole('button', { name: '保存' }).first().click()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).not.toContainText(
    'effect_goal',
  )
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText('無作為')
})

test('守る指標の名前を書くと, 向きと守る線の問いが出て, 筋道に出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await page.getByRole('button', { name: /解けたと言える/ }).click()
  await expect(page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' })).toHaveCount(
    0,
  )
  const name = page.getByLabel(/引き換えに悪くしてはいけない数字/)
  await name.fill('品切れした品と日の割合')
  await name.blur()
  await expect(page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' })).toBeVisible()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText('守る線')
  await page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' }).fill('5')
  await page.getByRole('textbox', { name: 'どこまでなら許せますか (守る線)' }).blur()
  await page
    .getByRole('radiogroup', { name: /守る指標は, 小さいほど良いですか/ })
    .getByLabel('小さいほど良い')
    .check()
  await expect(page.getByText(/守る指標: 品切れした品と日の割合 \(5 を超えない\)/)).toBeVisible()
})

test('予測を後段の仕組みに渡すと, 後段が求めるものの問いが出る', async ({ page }) => {
  await page.goto('/api/auth?token=e2e-token')
  await page.getByRole('button', { name: '総菜の作る量' }).click()
  await page.getByRole('button', { name: /機械学習の受け持ち/ }).click()
  const downstream = page.getByRole('textbox', { name: '後段は何で, 予測に何を求めますか' })
  await expect(downstream).toHaveCount(0)
  await page.getByRole('radio', { name: /後段の仕組みに渡す/ }).check()
  await expect(downstream).toBeVisible()
  await expect(page.getByRole('list', { name: '確かめ', exact: true })).toContainText(
    '後段が求める形と精度',
  )
  await downstream.fill('発注の仕組み. 品ごとの個数')
  await downstream.blur()
  await expect(page.getByText(/予測の使い道: 後段の仕組みに渡す/)).toBeVisible()
})
