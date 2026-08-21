import { useEffect } from 'react'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { keybindingMatchesAction } from '../../../../../shared/keybindings'
import { isEditableKeyboardTarget } from '../host-guest/browser-keyboard'
import type { RemoteBrowserPaneNotice } from './remote-browser-page-input-model'

/**
 * Chords a streamed pane must answer itself rather than forward as keystrokes. browser.keypress
 * reaches the remote page through Input.dispatchKeyEvent, which cannot drive Chrome's own
 * browser-level UI — so a forwarded Cmd/Ctrl+R never reloaded and a forwarded Cmd/Ctrl+F never
 * opened anything. The capture listener also covers the screencast image, whose React key handler
 * would otherwise forward them: a capture-phase stopPropagation never reaches the target.
 */
export function useRemoteBrowserPageChromeChords({
  isActive,
  runRemoteNavigation,
  setPaneNotice
}: {
  isActive: boolean
  runRemoteNavigation: (method: 'browser.reload') => Promise<void> | void
  setPaneNotice: (notice: RemoteBrowserPaneNotice | null) => void
}): void {
  const keybindings = useAppStore((state) => state.keybindings)

  useEffect(() => {
    if (!isActive) {
      return
    }
    const shortcutPlatform = getShortcutPlatform()
    const handleKeyDown = (event: KeyboardEvent): void => {
      // Why: Cmd+F should open find even from the address bar (Chrome/Safari do), but reload must
      // not fire while the user is typing a URL.
      if (keybindingMatchesAction('browser.find', event, shortcutPlatform, keybindings)) {
        event.preventDefault()
        event.stopPropagation()
        // Why: the pane shows decoded frames, not a live DOM, so there is nothing here to search.
        // Saying so beats forwarding a keystroke that provably does nothing on the host.
        setPaneNotice({
          kind: 'direct',
          text: translate(
            'browser.remote.findUnavailable',
            'Find in page is not available while this page streams from the remote host.'
          )
        })
        return
      }
      const isHardReload = keybindingMatchesAction(
        'browser.hardReload',
        event,
        shortcutPlatform,
        keybindings
      )
      const isReload = keybindingMatchesAction(
        'browser.reload',
        event,
        shortcutPlatform,
        keybindings
      )
      if (!isHardReload && !isReload) {
        return
      }
      if (isEditableKeyboardTarget(event.target)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      // Why: the runtime exposes one reload; a hard reload would need a wire change, so both
      // chords land on it rather than one of them silently doing nothing.
      void runRemoteNavigation('browser.reload')
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [isActive, keybindings, runRemoteNavigation, setPaneNotice])
}
