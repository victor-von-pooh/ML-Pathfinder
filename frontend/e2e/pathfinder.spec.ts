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

  // 3 の分解の書きかけを残して 1 へ移り, 戻る
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await page.getByLabel('要因 1').fill('勘で決める')
  await page.getByRole('button', { name: '前の節' }).click()
  await page.getByRole('button', { name: '次の節' }).click()
  await expect(page.getByLabel('要因 1')).toHaveValue('勘で決める')

  // 機械学習を使うと, 6 の列の問いが出る. 列の一覧が無くても 1 行に 1 つで答えられる
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
