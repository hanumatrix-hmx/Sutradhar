/**
 * @file packages/frontend/src/components/ui/CommandPalette.tsx
 * @description Command Palette — Cmd+K triggered, categorised commands, full keyboard nav.
 * Portal-rendered, zero inline styles.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn.js';

export interface CommandItem {
  id:        string;
  title:     string;
  category?: string;
  shortcut?: string;
  icon?:     React.ReactNode;
  onSelect:  () => void;
}

export interface CommandPaletteProps {
  isOpen:   boolean;
  onClose:  () => void;
  commands: readonly CommandItem[];
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  commands,
}) => {
  const [query,         setQuery]         = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef   = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  const filtered = commands.filter(
    (cmd) =>
      cmd.title.toLowerCase().includes(query.toLowerCase()) ||
      (cmd.category?.toLowerCase().includes(query.toLowerCase()) ?? false),
  );

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setSelectedIndex(0);
    // Defer focus to next tick so portal has mounted
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen]); // stable — onClose accessed via ref

  const handleInputKey = useCallback((e: React.KeyboardEvent) => {
    const len = filtered.length || 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((p) => (p + 1) % len); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((p) => (p - 1 + len) % len); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) { item.onSelect(); onCloseRef.current(); }
    }
  }, [filtered, selectedIndex]);

  if (!isOpen) return null;

  // Group commands by category
  const groups = filtered.reduce<Map<string, CommandItem[]>>((acc, cmd) => {
    const key = cmd.category ?? 'General';
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key)!.push(cmd);
    return acc;
  }, new Map());

  let globalIdx = 0;

  return createPortal(
    <div
      className="pt-overlay"
      style={{ zIndex: 700 /* --pt-z-command-palette */, alignItems: 'flex-start', paddingTop: '14vh' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="pt-cmd-palette"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="pt-cmd-palette__input-row">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="pt-cmd-palette__search-icon" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 10L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleInputKey}
            className="pt-cmd-palette__input"
            aria-autocomplete="list"
          />
        </div>

        {/* Results */}
        <div className="pt-cmd-palette__list" role="listbox">
          {filtered.length === 0 ? (
            <div style={{ padding: '20px 14px', textAlign: 'center', color: 'var(--pt-text-tertiary)', fontSize: 'var(--pt-text-base)' }}>
              No commands found
            </div>
          ) : (
            Array.from(groups.entries()).map(([groupName, items]) => (
              <div key={groupName}>
                {groups.size > 1 && (
                  <div className="pt-cmd-palette__group-label">{groupName}</div>
                )}
                {items.map((cmd) => {
                  const itemIdx    = globalIdx++;
                  const isSelected = itemIdx === selectedIndex;
                  return (
                    <div
                      key={cmd.id}
                      role="option"
                      aria-selected={isSelected}
                      className={cn(
                        'pt-cmd-palette__item',
                        isSelected && 'pt-cmd-palette__item--selected',
                      )}
                      onMouseEnter={() => setSelectedIndex(itemIdx)}
                      onClick={() => { cmd.onSelect(); onClose(); }}
                    >
                      <div className="pt-cmd-palette__item-left">
                        {cmd.icon && <span className="pt-cmd-palette__item-icon" aria-hidden="true">{cmd.icon}</span>}
                        <div>
                          <div className="pt-cmd-palette__item-title">{cmd.title}</div>
                        </div>
                      </div>
                      {cmd.shortcut && <kbd className="pt-kbd">{cmd.shortcut}</kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="pt-cmd-palette__footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
