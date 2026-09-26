import React from 'react';
import { haptic } from '../hooks/useTelegramWebApp';
import { Home, Target, Aperture, Backpack, ScrollText, Trophy } from 'lucide-react';

export type TabKey = 'home' | 'tasks' | 'wheel' | 'contest' | 'inventory' | 'history' | 'store';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'home', label: 'الرئيسية', icon: <Home size={22} /> },
  { key: 'tasks', label: 'المهام', icon: <Target size={22} /> },
  { key: 'wheel', label: 'الدوران', icon: <Aperture size={22} /> },
  { key: 'contest', label: 'السباق', icon: <Trophy size={22} /> },
  { key: 'inventory', label: 'المخزون', icon: <Backpack size={22} /> },
  { key: 'history', label: 'السجل', icon: <ScrollText size={22} /> },
];

export function BottomNav({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`nav-item ${active === tab.key ? 'active' : ''}`}
          onClick={() => {
            haptic('light');
            onChange(tab.key);
          }}
        >
          <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}