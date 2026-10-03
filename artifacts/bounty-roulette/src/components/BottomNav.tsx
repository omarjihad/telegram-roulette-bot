import React from 'react';
import { haptic } from '../hooks/useTelegramWebApp';
import { tr } from '../i18n';
import { Home, Target, Aperture, Backpack, Users, Trophy } from 'lucide-react';

export type TabKey = 'home' | 'tasks' | 'wheel' | 'contest' | 'inventory' | 'history' | 'store' | 'games' | 'referrals' | 'exchange' | 'proofs' | 'snake';

function tabs(): { key: TabKey; label: string; icon: React.ReactNode }[] {
  return [
    { key: 'home', label: tr('الرئيسية', 'Home'), icon: <Home size={22} /> },
    { key: 'tasks', label: tr('المهام', 'Tasks'), icon: <Target size={22} /> },
    { key: 'wheel', label: tr('الدوران', 'Spin'), icon: <Aperture size={22} /> },
    { key: 'contest', label: tr('السباق', 'Race'), icon: <Trophy size={22} /> },
    { key: 'inventory', label: tr('المخزون', 'Bag'), icon: <Backpack size={22} /> },
    { key: 'referrals', label: tr('إحالاتي', 'Invites'), icon: <Users size={22} /> },
  ];
}

export function BottomNav({ active, onChange, hideContest = false }: { active: TabKey; onChange: (t: TabKey) => void; hideContest?: boolean }) {
  return (
    <nav className="bottom-nav">
      {tabs().filter((tab) => !(hideContest && tab.key === 'contest')).map((tab) => (
        <button
          key={tab.key}
          className={`nav-item ${active === tab.key ? 'active' : ''}`}
          onClick={() => {
            haptic('light');
            onChange(tab.key);
          }}
        >
          <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{tab.icon}</span>
          <span className="nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}