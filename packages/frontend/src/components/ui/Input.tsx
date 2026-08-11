/**
 * @file packages/frontend/src/components/ui/Input.tsx
 * @description Input primitive — label, error, shortcut badge, omnibox mode.
 * Zero inline styles.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?:        string;
  error?:        string;
  shortcutBadge?: string;
  isOmnibox?:    boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, shortcutBadge, isOmnibox = false, id, className, ...props },
    ref,
  ) => {
    const inputId = id ?? (label ? `pt-input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const errorId = error ? `${inputId ?? 'input'}-error` : undefined;

    return (
      <div style={{ width: '100%' }}>
        {label && (
          <label htmlFor={inputId} className="pt-label">
            {label}
          </label>
        )}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'pt-input',
              isOmnibox && 'pt-input--omnibox',
              error       && 'pt-input--error',
              className,
            )}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            style={shortcutBadge ? { paddingRight: '58px' } : undefined}
            {...props}
          />
          {shortcutBadge && (
            <kbd className="pt-kbd" style={{ position: 'absolute', right: '10px', pointerEvents: 'none' }}>
              {shortcutBadge}
            </kbd>
          )}
        </div>
        {error && (
          <p id={errorId} role="alert" className="pt-field-error">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /**
   * Accepted for API compatibility with components/ui/TextArea.js, but this
   * minimal variant does not implement auto-grow. It must be destructured out
   * of the props spread so it never leaks onto the DOM element.
   */
  autoResize?: boolean;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, autoResize = false, className, ...props }, ref) => {
    const textareaId = label ? `pt-textarea-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined;

    return (
      <div style={{ width: '100%' }}>
        {label && (
          <label htmlFor={textareaId} className="pt-label">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn('pt-input', error && 'pt-input--error', className)}
          style={{ minHeight: '80px', fontFamily: 'inherit', resize: autoResize ? 'none' : 'vertical' }}
          {...props}
        />
        {error && <p className="pt-field-error">{error}</p>}
      </div>
    );
  },
);

TextArea.displayName = 'TextArea';
