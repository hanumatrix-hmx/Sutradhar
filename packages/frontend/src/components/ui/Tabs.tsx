/**
 * @file packages/frontend/src/components/ui/Tabs.tsx
 * @description Accessible Tabs — ARIA tablist, keyboard arrow navigation, compact variant.
 */

import React from 'react';
import { cn } from '../../utils/cn.js';

export interface TabItem {
  id:        string;
  label:     React.ReactNode;
  disabled?: boolean;
  count?:    number;
}

export interface TabsProps {
  tabs:        readonly TabItem[];
  activeTabId: string;
  onChange:    (tabId: string) => void;
  compact?:    boolean;
  className?:  string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTabId,
  onChange,
  compact   = false,
  className,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End')  next = tabs.length - 1;
    else return;

    e.preventDefault();
    const target = tabs[next];
    if (target && !target.disabled) onChange(target.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Navigation tabs"
      className={cn('pt-tabs', compact && 'pt-tabs--compact', className)}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            className={cn('pt-tab', isActive && 'pt-tab--active')}
            onClick={() => !tab.disabled && onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className="pt-badge pt-badge--neutral"
                style={{ marginLeft: '4px', fontSize: '10px', padding: '1px 5px' }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
