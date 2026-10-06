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

      <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenSnake}>
        <span className="art-bg" style={{ backgroundImage: 'url(/art/snake.svg)' }} />
        <span className="art-shade" />
        <span className="home-section-label">{tr('🐍 لعبة', '🐍 Game')}</span>
        <strong>{tr('لعبة الحية', 'Snake')}</strong>
        <span className="art-card-sub">{tr('كُل التفاح واجمع النقاط، وانتبه لا تعض نفسك!', 'Eat apples, collect points, and don’t bite yourself!')}</span>
        {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
      </button>

      <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenZiggurat}>
        <span className="art-bg" style={{ backgroundImage: 'url(/art/ziggurat.svg)' }} />
        <span className="art-shade" />
        <span className="home-section-label">{tr('🏛️ لعبة', '🏛️ Game')}</span>
        <strong>{tr('زقورة', 'Ziggurat')}</strong>
        <span className="art-card-sub">{tr('رصّ الطابوق وعلّي الزقورة لحد السما', 'Stack the bricks and raise the ziggurat to the sky')}</span>
        {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
      </button>

      {/* A teaser only: the game itself isn't built yet. */}
      <button className="art-card game-tile game-tile-locked" onClick={soon} aria-label={tr('المؤقت، قريباً', 'The Timer, coming soon')}>
        <span className="art-bg" style={{ backgroundImage: 'url(/art/timer.svg)' }} />
        <span className="art-shade" />
        <span className="home-section-label">{tr('⏱️ لعبة جديدة', '⏱️ New game')}</span>
        <strong>{tr('المؤقت', 'The Timer')}</strong>
        <span className="art-card-sub">{tr('وقّف الساعة على الوقت المطلوب بالضبط', 'Stop the clock right on the target time')}</span>
        <span className="game-soon-center">
          <b>{tr('قريباً', 'SOON')}</b>
          <span>{tr('ترقّبوا 🔥', 'Stay tuned 🔥')}</span>
        </span>
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
