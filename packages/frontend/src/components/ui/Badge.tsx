/**
 * @file packages/frontend/src/components/ui/Badge.tsx
 * @description Badge primitive — semantic status chips with optional dot indicator.
 * All styling delegated to CSS classes.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'accent' | 'neutral' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  showDot?: boolean;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  showDot = false,
  children,
  className,
  ...props
}) => (
  <span className={cn('pt-badge', `pt-badge--${variant}`, className)} {...props}>
    {showDot && <span className="pt-badge--dot" aria-hidden="true" />}
    {children}
  </span>
);

/* Evidence meter — AI confidence score display */
export interface EvidenceMeterProps {
  score:          number;
  recommendation: string;
}

export const EvidenceMeter: React.FC<EvidenceMeterProps> = ({ score, recommendation }) => {
  const variant: BadgeVariant =
    score >= 0.9 ? 'success' : score >= 0.7 ? 'warning' : 'danger';

  return (
    <Badge variant={variant} showDot>
      <span>{score.toFixed(2)}</span>
      <span style={{ opacity: 0.8 }}>· {recommendation}</span>
    </Badge>
  );
};
