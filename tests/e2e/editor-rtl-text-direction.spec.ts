import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const HEBREW_FILE = 'rtl-notes.txt'
// Hebrew prose plus an LTR code token, so 'auto' has something to disagree with 'rtl' about.
const HEBREW_CONTENT = 'שלום עולם, זה קובץ בעברית.\nconst answer = 42\nמרחבא بالعالم\n'

test('reveals and applies the RTL text-direction toggle for a Hebrew file', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  const fixture = createGoldenWorktree(testRepoPath, 'rtl-direction')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const filePath = path.join(fixture.worktreePath, HEBREW_FILE)
  writeFileSync(filePath, HEBREW_CONTENT, 'utf8')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  const worktreeId = await orcaPage.evaluate(
    () => window.__store?.getState().activeWorktreeId ?? null
  )
  expect(worktreeId).toBeTruthy()

  const fileId = await orcaPage.evaluate(
    ({ absolutePath, relativePath, wId }) => {
      const state = window.__store?.getState()
      state?.openFile({
        filePath: absolutePath,
        relativePath,
        worktreeId: wId,
        language: 'plaintext',
        mode: 'edit'
      })
      return (
        window.__store?.getState().openFiles.find((file) => file.filePath === absolutePath)?.id ??
        null
      )
    },
    { absolutePath: filePath, relativePath: HEBREW_FILE, wId: String(worktreeId) }
  )
  expect(fileId).toBeTruthy()

  const monaco = orcaPage.locator('.monaco-editor').first()
  await expect(monaco).toBeVisible({ timeout: 25_000 })
  await expect(orcaPage.locator('.view-line').first()).toContainText('שלום', { timeout: 20_000 })

  // The toggle only appears because the file holds strong RTL text.
  const directionButton = orcaPage.getByRole('button', { name: 'Text Direction' })
  await expect(directionButton).toBeVisible({ timeout: 20_000 })
  await expect(directionButton).toHaveAttribute('aria-pressed', 'false')
  await expect(orcaPage.locator('.editor-dir-rtl')).toHaveCount(0)

  const ltrShot = testInfo.outputPath('editor-direction-ltr.png')
  await monaco.screenshot({ path: ltrShot })
  await testInfo.attach('editor-direction-ltr', { path: ltrShot, contentType: 'image/png' })

  await directionButton.click()

  await expect(directionButton).toHaveAttribute('aria-pressed', 'true')
  await expect(orcaPage.locator('.editor-dir-rtl')).toHaveCount(1)
  expect(
    await orcaPage.evaluate(
      (id) => window.__store?.getState().editorTextDirectionByFile[id],
      fileId
    )
  ).toBe('rtl')

  const rtlShot = testInfo.outputPath('editor-direction-rtl.png')
  await monaco.screenshot({ path: rtlShot })
  await testInfo.attach('editor-direction-rtl', { path: rtlShot, contentType: 'image/png' })

  // Text stays selectable and the caret still lands, so RTL is not a read-only mode.
  await orcaPage.locator('.view-line').first().click()
  await expect(monaco).toBeVisible()

  // Toggling back drops the override rather than pinning an explicit 'ltr'.
  await directionButton.click()
  await expect(directionButton).toHaveAttribute('aria-pressed', 'false')
  await expect(orcaPage.locator('.editor-dir-rtl')).toHaveCount(0)
  expect(
    await orcaPage.evaluate(
      (id) => window.__store?.getState().editorTextDirectionByFile[id] ?? null,
      fileId
    )
  ).toBeNull()
})
