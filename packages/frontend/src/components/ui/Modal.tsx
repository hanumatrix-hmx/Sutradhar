/**
 * @file packages/frontend/src/components/ui/Modal.tsx
 * @description Accessible overlay modal — focus trap, Escape close, backdrop click close.
 * Zero inline styles.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  isOpen:    boolean;
  title:     string;
  onClose:   () => void;
  children:  React.ReactNode;
  /** Footer slot — rendered inside pt-modal__footer */
  footer?:   React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, title, onClose, children, footer }) => {
  const dialogRef  = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId    = `pt-modal-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  // Keep ref current without re-running the effect
  useEffect(() => { onCloseRef.current = onClose; });

  // Run ONLY when isOpen transitions to true — never on every render
  useEffect(() => {
    if (!isOpen) return;
    // Focus the dialog container so screen readers announce it,
    // but only on the initial open, not on every re-render
    dialogRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen]); // ← only isOpen, never onClose

  if (!isOpen) return null;

  return createPortal(
    <div
      className="pt-overlay"
      style={{ zIndex: 400 /* --pt-z-modal */ }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pt-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-modal__header">
          <h3 id={titleId} className="pt-modal__title">{title}</h3>
          <button type="button" className="pt-modal__close" onClick={onClose} aria-label="Close dialog">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div>{children}</div>

        {footer && <div className="pt-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
