/**
 * @file packages/frontend/src/components/auth/AuthPromptModal.tsx
 * @description Floating human-in-the-loop banner for manual sign-in on the viewport.
 *
 * Phase 0 honesty fix: this banner ONLY appears when the session genuinely
 * requires authentication (session.authRequired). It never collects
 * credentials itself — signing in on the real page is the user's action, and
 * the app must not store passwords. Backend/transport errors use the
 * session-level error card instead, never this banner.
 */

import React from 'react';
import { Button } from '../ui/Button.js';
import { IconLock, IconX } from '../ui/icons.js';

export interface AuthPromptModalProps {
  isOpen: boolean;
  siteName: string;
  onResumeManual: () => void;
  onCancel: () => void;
}

export const AuthPromptModal: React.FC<AuthPromptModalProps> = ({
  isOpen,
  siteName,
  onResumeManual,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '64px',
        right: '24px',
        zIndex: 9999,
        pointerEvents: 'none', // Allows clicking & typing directly into the viewport behind!
        maxWidth: '480px',
        width: 'calc(100% - 48px)',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background: 'var(--pt-surface-1)',
          borderRadius: 'var(--pt-radius-3)',
          boxShadow: 'var(--pt-shadow-raised-lg)',
          padding: 'var(--pt-space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--pt-space-3)',
          animation: 'pt-soft-enter var(--pt-duration-panel) var(--pt-ease-soft) both',
        }}
      >
        {/* Banner Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--pt-space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--pt-space-2)', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--pt-semantic-warning)', marginTop: '2px' }}>
              <IconLock size={16} />
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--pt-text-sm)', color: 'var(--pt-text-heading)' }}>
                Sign-in required
              </div>
              <div style={{ fontSize: 'var(--pt-text-xs)', color: 'var(--pt-text-secondary)' }}>
                {siteName ? `${siteName} is asking you to sign in. ` : ''}
                Sign in on the viewport below, then resume. Credentials are never entered into PinchTab itself.
              </div>
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} title="Archive session" aria-label="Archive session">
            <IconX size={14} />
          </Button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="button" variant="primary" size="sm" onClick={onResumeManual}>
            I have signed in — Resume
          </Button>
        </div>
      </div>
    </div>
  );
};
