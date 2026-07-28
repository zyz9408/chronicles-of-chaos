import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const INITIAL_FOCUS_SELECTOR = [
  '[data-modal-initial-focus]',
  '.system-modal-close',
  '.save-modal-close',
  '.settings-nav-close',
].join(', ');

interface InertSnapshot {
  element: HTMLElement;
  hadInert: boolean;
  ariaHidden: string | null;
}

interface DialogAttributeSnapshot {
  ariaModal: string | null;
  tabIndex: string | null;
}

interface ModalAccessibilityOptions {
  modalKey: string | null;
  scopeRef: RefObject<HTMLElement>;
  onClose: () => void;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true');
}

function makeBackgroundInert(modalLayer: HTMLElement): () => void {
  const snapshots: InertSnapshot[] = [];
  let branch: HTMLElement = modalLayer;
  let parent = branch.parentElement;

  while (parent) {
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      snapshots.push({
        element: sibling,
        hadInert: sibling.hasAttribute('inert'),
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.setAttribute('inert', '');
      sibling.setAttribute('aria-hidden', 'true');
    }

    if (parent === document.body) break;
    branch = parent;
    parent = parent.parentElement;
  }

  return () => {
    for (const snapshot of snapshots.reverse()) {
      if (!snapshot.hadInert) snapshot.element.removeAttribute('inert');
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
    }
  };
}

export function useModalAccessibility({ modalKey, scopeRef, onClose }: ModalAccessibilityOptions): void {
  const onCloseRef = useRef(onClose);
  const currentModalKeyRef = useRef(modalKey);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;
  currentModalKeyRef.current = modalKey;

  useEffect(() => {
    const scope = scopeRef.current;
    if (!modalKey || !scope) return undefined;

    const resolveCurrentDialog = (): HTMLElement | undefined => {
      const dialogs = Array.from(scope.querySelectorAll<HTMLElement>('[role="dialog"]'));
      return dialogs[dialogs.length - 1];
    };
    let currentDialog = resolveCurrentDialog();
    if (!currentDialog) return undefined;

    const modalLayer = currentDialog.closest<HTMLElement>('.system-modal-backdrop, .modal-backdrop') ?? currentDialog;
    const activeElement = document.activeElement;
    if ((!restoreFocusRef.current || !restoreFocusRef.current.isConnected) && activeElement instanceof HTMLElement) {
      restoreFocusRef.current = activeElement;
    }

    const dialogSnapshots = new Map<HTMLElement, DialogAttributeSnapshot>();
    const prepareDialog = (dialog: HTMLElement) => {
      if (!dialogSnapshots.has(dialog)) {
        dialogSnapshots.set(dialog, {
          ariaModal: dialog.getAttribute('aria-modal'),
          tabIndex: dialog.getAttribute('tabindex'),
        });
      }
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
    };
    prepareDialog(currentDialog);
    const restoreBackground = makeBackgroundInert(modalLayer);

    let focusFrame = 0;
    const queueDialogFocus = (dialog: HTMLElement) => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        if (!dialog.isConnected || resolveCurrentDialog() !== dialog || dialog.contains(document.activeElement)) return;
        const initialFocus = dialog.querySelector<HTMLElement>(INITIAL_FOCUS_SELECTOR)
          ?? getFocusableElements(dialog)[0]
          ?? dialog;
        initialFocus.focus();
      });
    };
    queueDialogFocus(currentDialog);

    const observer = new MutationObserver(() => {
      const nextDialog = resolveCurrentDialog();
      if (!nextDialog || nextDialog === currentDialog) return;
      currentDialog = nextDialog;
      prepareDialog(nextDialog);
      queueDialogFocus(nextDialog);
    });
    observer.observe(scope, { childList: true, subtree: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = resolveCurrentDialog();
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const focused = document.activeElement;
      if (event.shiftKey && (focused === first || !dialog.contains(focused))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focused === last || !dialog.contains(focused))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      observer.disconnect();
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreBackground();
      for (const [dialog, snapshot] of dialogSnapshots) {
        if (snapshot.ariaModal === null) dialog.removeAttribute('aria-modal');
        else dialog.setAttribute('aria-modal', snapshot.ariaModal);
        if (snapshot.tabIndex === null) dialog.removeAttribute('tabindex');
        else dialog.setAttribute('tabindex', snapshot.tabIndex);
      }

      if (currentModalKeyRef.current === null) {
        const restoreTarget = restoreFocusRef.current;
        restoreFocusRef.current = null;
        window.setTimeout(() => {
          if (restoreTarget?.isConnected) restoreTarget.focus();
        }, 0);
      }
    };
  }, [modalKey, scopeRef]);
}
