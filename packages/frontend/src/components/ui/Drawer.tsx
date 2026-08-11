/**
 * @file packages/frontend/src/components/ui/Drawer.tsx
 * @description Side-panel Drawer — left or right position, portal-rendered, Escape close.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn.js';

export interface DrawerProps {
  isOpen:    boolean;
  title:     string;
  position?: 'right' | 'left';
  onClose:   () => void;
  children:  React.ReactNode;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  title,
  position = 'right',
  onClose,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId  = `pt-drawer-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="pt-overlay"
      style={{ zIndex: 300 /* --pt-z-drawer */ }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn('pt-drawer', `pt-drawer--${position}`)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-drawer__header">
          <h3 id={titleId} className="pt-drawer__title">{title}</h3>
          <button type="button" className="pt-modal__close" onClick={onClose} aria-label="Close panel">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
};
