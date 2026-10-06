import React, { useState } from 'react';
import { tr } from '../i18n';
import { haptic } from '../hooks/useTelegramWebApp';
import { SectionHero } from '../components/Common';

/** The games section: every game gets a card here (more are coming). */
export function GamesHubPage({
  onBack,
  onOpenSnake,
  onOpenZiggurat,
  snakeLocked,
}: {
  onBack: () => void;
  onOpenSnake: () => void;
  onOpenZiggurat: () => void;
  snakeLocked: boolean;
}) {
  const [toast, setToast] = useState<string | null>(null);

  function soon() {
    haptic('light');
    setToast(tr('🔜 قريباً', '🔜 Coming soon'));
    window.setTimeout(() => setToast(null), 2000);
  }

  return (
    <div className="games-hub">
      <SectionHero
        art="games"
        title={tr('🎮 قسم الألعاب', '🎮 Games')}
        subtitle={tr('العب، استمتع، واجمع نقاط للعجلة', 'Play, have fun and collect wheel points')}
        onBack={onBack}
      />

      {/* Two games per row: Snake · Ziggurat, then Flying · Timer (both coming soon). */}
      <div className="games-grid">
        <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenSnake}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/snake.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('🐍 الحية', '🐍 Snake')}</strong>
          <span className="art-card-sub">{tr('كُل التفاح ولا تعض نفسك', 'Eat apples, don’t bite yourself')}</span>
          {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
        </button>

        <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenZiggurat}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/ziggurat.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('🏛️ زقورة', '🏛️ Ziggurat')}</strong>
          <span className="art-card-sub">{tr('رصّ الطابوق لحد السما', 'Stack bricks to the sky')}</span>
          {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
        </button>

        {/* Teasers only: these games aren't built yet. */}
        <button className="art-card game-tile game-tile-locked" onClick={soon} aria-label={tr('طيران، قريباً', 'Flying, coming soon')}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/flappy.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('🐦 طيران', '🐦 Flying')}</strong>
          <span className="art-card-sub">{tr('طير بين الأنابيب', 'Fly between the pipes')}</span>
          <span className="game-soon-center"><b>{tr('قريباً', 'SOON')}</b></span>
        </button>

        <button className="art-card game-tile game-tile-locked" onClick={soon} aria-label={tr('المؤقت، قريباً', 'The Timer, coming soon')}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/timer.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('⏱️ المؤقت', '⏱️ The Timer')}</strong>
          <span className="art-card-sub">{tr('وقّف الساعة بالضبط', 'Stop the clock exactly')}</span>
          <span className="game-soon-center"><b>{tr('قريباً', 'SOON')}</b></span>
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
