/**
 * @file packages/frontend/src/components/ui/Progress.tsx
 * @description Progress bar primitive — determinate and indeterminate variants.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export type ProgressVariant = 'primary' | 'success' | 'warning' | 'danger';

export interface ProgressProps {
  value?:       number;  /** 0–100 for determinate; omit for indeterminate */
  variant?:     ProgressVariant;
  label?:       string;
  showLabel?:   boolean;
  className?:   string;
  size?:        'sm' | 'md' | 'lg';
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  variant   = 'primary',
  label     = 'Loading',
  showLabel = false,
  className,
}) => {
  const isIndeterminate = value === undefined;

  return (
    <div
      role="progressbar"
      aria-valuenow={isIndeterminate ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('pt-progress', isIndeterminate && 'pt-progress--indeterminate', className)}
    >
      <div
        className={cn('pt-progress__fill', `pt-progress__fill--${variant}`)}
        style={isIndeterminate ? undefined : { width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
      />
      {showLabel && !isIndeterminate && (
        <span className="pt-sr-only">{value}%</span>
      )}
    </div>
  );
};
