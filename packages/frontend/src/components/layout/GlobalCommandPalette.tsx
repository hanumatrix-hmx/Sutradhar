/**
 * @file packages/frontend/src/components/layout/GlobalCommandPalette.tsx
 * @description Global Command Palette — full command model covering navigation,
 * browser actions, session management, and AI directives.
 */

import React from 'react';
import { CommandPalette, CommandItem } from '../ui/CommandPalette.js';
import { useSessionStore } from '../../stores/sessionStore.js';
import { useRouter } from '../../app/router.js';
import {
  IconArrowRight,
  IconDownload,
  IconGlobe,
  IconHome,
  IconPause,
  IconPlay,
  IconPlus,
  IconSettings,
} from '../ui/icons.js';

export interface GlobalCommandPaletteProps {
  isOpen:               boolean;
  onClose:              () => void;
  onOpenNewSessionModal: () => void;
}

export const GlobalCommandPalette: React.FC<GlobalCommandPaletteProps> = ({
  isOpen,
  onClose,
  onOpenNewSessionModal,
}) => {
  const { sessions, openSession } = useSessionStore();
  const { navigate } = useRouter();

  const commands: CommandItem[] = [
    /* ---- Actions ---- */
    {
      id:       'cmd_new_session',
      title:    'New Session',
      category: 'Actions',
      shortcut: '⌘N',
      icon:     <IconPlus size={13} />,
      onSelect: () => { onClose(); onOpenNewSessionModal(); },
    },

    /* ---- Navigation ---- */
    {
      id:       'cmd_nav_home',
      title:    'Go to Home',
      category: 'Navigation',
      icon:     <IconHome size={13} />,
      onSelect: () => navigate('/'),
    },
    {
      id:       'cmd_nav_sessions',
      title:    'Go to Sessions',
      category: 'Navigation',
      icon:     <IconArrowRight size={13} />,
      onSelect: () => navigate('/sessions'),
    },
    {
      id:       'cmd_nav_downloads',
      title:    'Go to Downloads',
      category: 'Navigation',
      icon:     <IconDownload size={13} />,
      onSelect: () => navigate('/downloads'),
    },
    {
      id:       'cmd_nav_settings',
      title:    'Go to Settings',
      category: 'Navigation',
      icon:     <IconSettings size={13} />,
      onSelect: () => navigate('/settings'),
    },

    /* ---- Agent ---- */
    {
      id:       'cmd_agent_pause',
      title:    'Pause Active Agent',
      category: 'Agent',
      icon:     <IconPause size={13} />,
      onSelect: () => {},  // Future: dispatch pause to agent runtime
    },
    {
      id:       'cmd_agent_resume',
      title:    'Resume Active Agent',
      category: 'Agent',
      icon:     <IconPlay size={13} />,
      onSelect: () => {},  // Future: dispatch resume
    },

    /* ---- Session switcher — open sessions are searchable right here ---- */
    ...sessions.map((sess) => ({
      id:       `cmd_sess_${sess.id}`,
      title:    `Open: ${sess.title}`,
      category: 'Sessions',
      icon:     <IconGlobe size={13} />,
      onSelect: () => {
        openSession(sess.id);
        navigate(`/session/${sess.id}`);
      },
    })),
  ];

  return <CommandPalette isOpen={isOpen} onClose={onClose} commands={commands} />;
};
