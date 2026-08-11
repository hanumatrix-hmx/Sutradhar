/**
 * @file packages/frontend/src/components/ui/Spinner.tsx
 * @description Spinner loading indicator — size variants, SR label.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  size?:      SpinnerSize;
  label?:     string;
  className?: string;
}

export const Spinner: React.FC<SpinnerProps> = ({
  size      = 'md',
  label     = 'Loading…',
  className,
}) => (
  <span
    role="status"
    className={cn(`pt-spinner pt-spinner--${size}`, className)}
    aria-label={label}
  />
);
