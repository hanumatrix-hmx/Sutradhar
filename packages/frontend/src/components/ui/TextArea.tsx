/**
 * @file packages/frontend/src/components/ui/TextArea.tsx
 * @description TextArea primitive — auto-resize, character count, error state.
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn.js';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?:         string;
  error?:         string;
  maxCharacters?: number;
  autoResize?:    boolean;
}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
  (
    { label, error, maxCharacters, autoResize = false, id, className, value, onChange, ...props },
    ref,
  ) => {
    const internalRef = useRef<HTMLTextAreaElement | null>(null);
    const textareaId  = id ?? (label ? `pt-textarea-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
    const errorId     = error ? `${textareaId ?? 'textarea'}-error` : undefined;
    const charCount   = typeof value === 'string' ? value.length : 0;

    const handleResize = useCallback(() => {
      const el = internalRef.current;
      if (el && autoResize) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    }, [autoResize]);

    useEffect(() => { handleResize(); }, [value, handleResize]);

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        internalRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      },
      [ref],
    );

    return (
      <div style={{ width: '100%' }}>
        {label && (
          <label htmlFor={textareaId} className="pt-label">
            {label}
          </label>
        )}
        <textarea
          ref={setRefs}
          id={textareaId}
          className={cn('pt-input', error && 'pt-input--error', className)}
          value={value}
          onChange={onChange}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          style={{ resize: autoResize ? 'none' : undefined, minHeight: '80px' }}
          {...props}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          {error && (
            <p id={errorId} role="alert" className="pt-field-error" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          {maxCharacters !== undefined && (
            <span
              className={charCount > maxCharacters ? 'pt-field-error' : undefined}
              style={{
                fontSize: 'var(--pt-text-xs)',
                color: charCount > maxCharacters ? undefined : 'var(--pt-text-tertiary)',
                marginLeft: 'auto',
              }}
            >
              {charCount}/{maxCharacters}
            </span>
          )}
        </div>
      </div>
    );
  },
);

TextArea.displayName = 'TextArea';
