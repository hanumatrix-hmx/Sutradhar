/**
 * @file packages/frontend/src/components/ui/Card.tsx
 * @description Card container — header, body, footer, hoverable, collapsible, clickable.
 * Zero inline styles for structural layout; only tokens used directly.
 */

import React, { useState } from 'react';
import { cn } from '../../utils/cn.js';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children:         React.ReactNode;
  title?:           string;
  subtitle?:        string;
  action?:          React.ReactNode;
  footer?:          React.ReactNode;
  hoverable?:       boolean;
  clickable?:       boolean;
  collapsible?:     boolean;
  defaultCollapsed?: boolean;
  size?:            'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  footer,
  hoverable       = false,
  clickable       = false,
  collapsible     = false,
  defaultCollapsed = false,
  size            = 'md',
  children,
  className,
  ...props
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasHeader = Boolean(title || subtitle || action || collapsible);

  return (
    <div
      className={cn(
        'pt-card',
        size !== 'md' && `pt-card--${size}`,
        hoverable  && 'pt-card--hoverable',
        clickable  && 'pt-card--clickable',
        className,
      )}
      {...props}
    >
      {hasHeader && (
        <div className="pt-card__header">
          <div>
            {title    && <h3 className="pt-card__title">{title}</h3>}
            {subtitle && <p  className="pt-card__subtitle">{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pt-space-2)' }}>
            {action}
            {collapsible && (
              <button
                type="button"
                className="pt-btn pt-btn--ghost pt-btn--xs pt-btn--icon"
                onClick={() => setCollapsed(!collapsed)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? 'Expand section' : 'Collapse section'}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d={collapsed ? 'M3 4.5L6 7.5L9 4.5' : 'M3 7.5L6 4.5L9 7.5'}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {!collapsed && <div>{children}</div>}

      {!collapsed && footer && (
        <div className="pt-card__footer">{footer}</div>
      )}
    </div>
  );
};
