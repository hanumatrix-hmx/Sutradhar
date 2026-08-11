/**
 * @file packages/frontend/src/components/ui/Dropdown.tsx
 * @description Dropdown select — accessible listbox, keyboard nav, group support.
 */

import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../utils/cn.js';

export interface DropdownOption {
  id:        string;
  label:     string;
  disabled?: boolean;
  danger?:   boolean;
}

export interface DropdownProps {
  label:      string;
  options:    readonly DropdownOption[];
  selectedId?: string;
  onChange:   (id: string) => void;
  placeholder?: string;
  className?: string;
}

export const Dropdown: React.FC<DropdownProps> = ({
  label,
  options,
  selectedId,
  onChange,
  placeholder,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.id === selectedId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={cn('pt-dropdown', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={label}
        className="pt-btn pt-btn--secondary pt-btn--md"
        style={{ gap: '8px' }}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setIsOpen(false);
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !isOpen) {
            e.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        <span>{selected ? selected.label : (placeholder ?? label)}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {isOpen && (
        <ul role="listbox" aria-label={label} className="pt-dropdown__menu">
          {options.map((opt) => (
            <li
              key={opt.id}
              role="option"
              aria-selected={opt.id === selectedId}
              aria-disabled={opt.disabled}
              className={cn(
                'pt-dropdown__item',
                opt.id === selectedId && 'pt-dropdown__item--selected',
                opt.danger            && 'pt-dropdown__item--danger',
              )}
              onClick={() => {
                if (!opt.disabled) {
                  onChange(opt.id);
                  setIsOpen(false);
                }
              }}
            >
              {opt.label}
              {opt.id === selectedId && (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginLeft: 'auto' }} aria-hidden="true">
                  <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
