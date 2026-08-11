/**
 * @file packages/frontend/src/components/ui/Toast.tsx
 * @description Toast notification system — portal-based ToastRegion + individual Toast.
 * ApprovalToast for Tier-3 agent action gates.
 */

import React, { useEffect, createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn.js';
import { Button } from './Button.js';

/* ------------------------------------------------------------------ */
/*  Toast context / provider                                             */
/* ------------------------------------------------------------------ */

export type ToastType = 'info' | 'success' | 'warning' | 'danger';

export interface ToastData {
  id:         string;
  title:      string;
  message?:   string;
  type?:      ToastType;
  durationMs?: number;
}

interface ToastContextValue {
  addToast: (data: Omit<ToastData, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export const useToast = (): ToastContextValue => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = useCallback((data: Omit<ToastData, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...data, id }]);
    const duration = data.durationMs ?? 4000;
    if (duration > 0) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration);
    }
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {createPortal(
        <div className="pt-toast-region" aria-live="polite" aria-label="Notifications">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
};

/* ------------------------------------------------------------------ */
/*  Single Toast item (internal)                                        */
/* ------------------------------------------------------------------ */

interface ToastItemProps {
  toast:     ToastData;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => (
  <div
    role="alert"
    className={cn('pt-toast', toast.type ? `pt-toast--${toast.type}` : 'pt-toast--info')}
  >
    <div className="pt-toast__content">
      <p className="pt-toast__title">{toast.title}</p>
      {toast.message && <p className="pt-toast__message">{toast.message}</p>}
    </div>
    <button
      type="button"
      className="pt-btn pt-btn--ghost pt-btn--xs pt-btn--icon"
      onClick={() => onDismiss(toast.id)}
      aria-label="Dismiss notification"
      style={{ flexShrink: 0 }}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  </div>
);

/* ------------------------------------------------------------------ */
/*  Legacy single Toast (for backward compat with SettingsPage)         */
/* ------------------------------------------------------------------ */

export interface ToastProps {
  message:   string;
  type?:     ToastType;
  onClose?:  () => void;
  durationMs?: number;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose, durationMs }) => {
  useEffect(() => {
    if (!durationMs || durationMs <= 0 || !onClose) return;
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onClose]);

  return (
    <div role="alert" aria-live="polite" className={cn('pt-toast', `pt-toast--${type}`)}>
      <div className="pt-toast__content">
        <p className="pt-toast__title">{message}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="pt-btn pt-btn--ghost pt-btn--xs pt-btn--icon"
          onClick={onClose}
          aria-label="Close notification"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M9 3L3 9M3 3l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Approval Toast — Tier-3 agent action gate                           */
/* ------------------------------------------------------------------ */

export interface ApprovalToastProps {
  actionDescription: string;
  onApprove:         () => void;
  onDeny:            () => void;
}

export const ApprovalToast: React.FC<ApprovalToastProps> = ({
  actionDescription,
  onApprove,
  onDeny,
}) => (
  <div
    role="dialog"
    aria-label="Agent action requires approval"
    className="pt-approval-gate"
  >
    <div className="pt-approval-gate__header">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2L14 13H2L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M8 6v3M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <span className="pt-approval-gate__title">Human Approval Required</span>
    </div>
    <p className="pt-approval-gate__body">
      The agent is requesting permission to perform:{' '}
      <strong>{actionDescription}</strong>
    </p>
    <div className="pt-approval-gate__actions">
      <Button variant="secondary" size="sm" onClick={onDeny}>Deny Action</Button>
      <Button variant="primary"   size="sm" onClick={onApprove}>Approve &amp; Execute</Button>
    </div>
  </div>
);
