import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import { EditorPanelHeader } from './EditorPanelHeader'

const storeStub = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  editorTextDirectionByFile: {} as Record<string, string>,
  setEditorTextDirectionOverride: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeGroupIdByWorktree: {},
      settings: storeStub.settings,
      editorTextDirectionByFile: storeStub.editorTextDirectionByFile,
      setEditorTextDirectionOverride: storeStub.setEditorTextDirectionOverride,
      updateSettings: vi.fn()
    })
}))

vi.mock('@/store/worktree-diff-comments-selector', () => ({
  selectWorktreeDiffCommentsOrEmpty: () => []
}))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({
    children,
    delayDuration
  }: {
    children: React.ReactNode
    delayDuration: number
  }) => (
    <div data-tooltip-provider data-delay-duration={delayDuration}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <span data-tooltip>{children}</span>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}))

vi.mock('./EditorPanelHeaderPath', () => ({
  EditorPanelHeaderPath: () => null
}))

vi.mock('./EditorPanelMarkdownActionsMenu', () => ({
  EditorPanelMarkdownActionsMenu: () => null
}))

vi.mock('@/components/artifacts/ArtifactPublishButton', () => ({
  ArtifactPublishButton: () => <button data-artifact-publish />
}))

vi.mock('./diff-navigation-context', () => ({
  useDiffNavigation: () => ({
    changeCount: 2,
    goToPreviousDiff: vi.fn(),
    goToNextDiff: vi.fn()
  })
}))

const activeFile: OpenFile = {
  id: 'diff:/repo/file.ts',
  filePath: '/repo/file.ts',
  relativePath: 'file.ts',
  worktreeId: 'repo::/repo',
  language: 'typescript',
  isDirty: false,
  mode: 'diff'
}

const baseProps = {
  activeFile,
  copiedPathVisible: false,
  isSingleDiff: false,
  isDiffSurface: true,
  isMarkdown: false,
  isCsv: false,
  isNotebook: false,
  hasEditorToggle: false,
  availableEditorToggleModes: [],
  effectiveToggleValue: 'edit',
  canOpenPreviewToSide: false,
  canShowMarkdownPreview: false,
  canShowMarkdownTableOfContents: false,
  canShowTextDirectionToggle: false,
  isMarkdownTableOfContentsDisabled: false,
  shouldShowMarkdownExportAction: false,
  canExportMarkdownToPdf: false,
  showMarkdownTableOfContents: false,
  canShowMarkdownFrontmatterToggle: false,
  markdownFrontmatterVisible: false,
  sideBySide: false,
  openFileState: { canOpen: false },
  onCopyPath: vi.fn(),
  onOpenDiffTargetFile: vi.fn(),
  onOpenPreviewToSide: vi.fn(),
  onOpenMarkdownPreview: vi.fn(),
  onOpenContainingFolder: vi.fn(),
  onToggleSideBySide: vi.fn(),
  onEditorToggleChange: vi.fn(),
  onToggleMarkdownTableOfContents: vi.fn(),
  onToggleMarkdownFrontmatter: vi.fn(),
  onExportMarkdownToPdf: vi.fn()
} satisfies ComponentProps<typeof EditorPanelHeader>

function renderHeader(overrides: Partial<ComponentProps<typeof EditorPanelHeader>> = {}): string {
  return renderToStaticMarkup(<EditorPanelHeader {...baseProps} {...overrides} />)
}

describe('EditorPanelHeader', () => {
  it('shares one tooltip provider across the diff header controls', () => {
    const html = renderHeader()

    expect(html.match(/data-tooltip-provider/g)).toHaveLength(1)
    expect(html.match(/data-tooltip="true"/g)).toHaveLength(3)
    expect(html).toContain('data-delay-duration="300"')
    expect(html).toContain('aria-label="Previous change"')
    expect(html).toContain('aria-label="Next change"')
  })

  it('offers artifact sharing only on non-diff Markdown surfaces', () => {
    const createRequest = vi.fn()

    expect(
      renderHeader({
        isDiffSurface: false,
        isMarkdown: true,
        createMarkdownArtifactRequest: createRequest
      })
    ).toContain('data-artifact-publish="true"')
    expect(
      renderHeader({
        isDiffSurface: true,
        isMarkdown: true,
        createMarkdownArtifactRequest: createRequest
      })
    ).not.toContain('data-artifact-publish')
    expect(
      renderHeader({
        isDiffSurface: false,
        isMarkdown: false,
        createMarkdownArtifactRequest: createRequest
      })
    ).not.toContain('data-artifact-publish')
  })

  describe('text direction toggle', () => {
    const editFile = { ...activeFile, mode: 'edit' } as OpenFile

    beforeEach(() => {
      storeStub.settings = {}
      storeStub.editorTextDirectionByFile = {}
      storeStub.setEditorTextDirectionOverride.mockClear()
    })

    it('stays hidden until the file actually holds RTL text', () => {
      expect(
        renderHeader({
          activeFile: editFile,
          isDiffSurface: false,
          canShowTextDirectionToggle: false
        })
      ).not.toContain('aria-label="Text Direction"')
    })

    it('renders unpressed for an LTR file that contains RTL text', () => {
      const html = renderHeader({
        activeFile: editFile,
        isDiffSurface: false,
        canShowTextDirectionToggle: true
      })

      expect(html).toContain('aria-label="Text Direction"')
      expect(html).toContain('aria-pressed="false"')
      expect(html).toContain('Right-to-Left')
    })

    it('renders pressed and offers the reverse label when the override is rtl', () => {
      storeStub.editorTextDirectionByFile = { [editFile.id]: 'rtl' }

      const html = renderHeader({
        activeFile: editFile,
        isDiffSurface: false,
        canShowTextDirectionToggle: true
      })

      expect(html).toContain('aria-pressed="true"')
      expect(html).toContain('Left-to-Right')
    })

    it('stays hidden on diff surfaces, where Monaco keeps LTR-only layout math', () => {
      expect(renderHeader({ isDiffSurface: true, canShowTextDirectionToggle: true })).not.toContain(
        'aria-label="Text Direction"'
      )
    })
  })
})
