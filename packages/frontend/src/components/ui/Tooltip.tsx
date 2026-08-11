/**
 * @file packages/frontend/src/components/ui/Tooltip.tsx
 * @description Accessible Tooltip — hover/focus triggered, 4-directional placement.
 * Zero inline styles except calculated position offsets.
 */

import React, { useState, useId } from 'react';

export interface TooltipProps {
  content:    string;
  position?:  'top' | 'bottom' | 'left' | 'right';
  children:   React.ReactElement;
  disabled?:  boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  position = 'top',
  children,
  disabled = false,
}) => {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();

  const positionStyle = (): React.CSSProperties => {
    switch (position) {
      case 'bottom': return { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };
      case 'left':   return { right: 'calc(100% + 6px)', top: '50%', transform: 'translateY(-50%)' };
      case 'right':  return { left: 'calc(100% + 6px)',  top: '50%', transform: 'translateY(-50%)' };
      default:       return { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };
    }
  };

  if (disabled) return children;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {React.cloneElement(children, { 'aria-describedby': visible ? tooltipId : undefined })}
      {visible && (
        <span id={tooltipId} role="tooltip" className="pt-tooltip" style={positionStyle()}>
          {content}
        </span>
      )}
    </span>
  );
};
