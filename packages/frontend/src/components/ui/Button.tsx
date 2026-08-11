/**
 * @file packages/frontend/src/components/ui/Button.tsx
 * @description Button primitive — full variant/size/icon/loading system.
 * All styling delegated to CSS classes. Zero inline styles.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
export type ButtonSize    = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:  ButtonVariant;
  size?:     ButtonSize;
  loading?:  boolean;
  iconLeft?: React.ReactNode;
  iconOnly?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant  = 'primary',
      size     = 'md',
      loading  = false,
      iconLeft,
      iconOnly = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          'pt-btn',
          `pt-btn--${variant}`,
          `pt-btn--${size}`,
          iconOnly && 'pt-btn--icon',
          className,
        )}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <span className="pt-spinner pt-spinner--sm" role="status" aria-label="Loading" />
        ) : (
          iconLeft && <span aria-hidden="true">{iconLeft}</span>
        )}
        {!iconOnly && children}
        {iconOnly && !loading && children}
      </button>
    );
  },
);

Button.displayName = 'Button';
