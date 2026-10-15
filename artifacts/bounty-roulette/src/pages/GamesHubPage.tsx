import React, { useState } from 'react';
import { tr } from '../i18n';
import { haptic } from '../hooks/useTelegramWebApp';
import { SectionHero } from '../components/Common';

/** The games section: every game gets a card here (more are coming). */
export function GamesHubPage({
  onBack,
  onOpenSnake,
  onOpenZiggurat,
  onOpenFlappy,
  onOpenTimer,
  snakeLocked,
}: {
  onBack: () => void;
  onOpenSnake: () => void;
  onOpenZiggurat: () => void;
  onOpenFlappy: () => void;
  onOpenTimer: () => void;
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

      {/* Two games per row: Snake · Ziggurat, then Flying · Timer. */}
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

        <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenFlappy}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/flappy.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('🐦 طيران', '🐦 Flying')}</strong>
          <span className="art-card-sub">{tr('طير بين الأعمدة', 'Fly between the columns')}</span>
          {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
        </button>

        <button className="art-card game-tile" onClick={snakeLocked ? soon : onOpenTimer}>
          <span className="art-bg" style={{ backgroundImage: 'url(/art/timer.svg)' }} />
          <span className="art-shade" />
          <strong>{tr('⏱️ المؤقت', '⏱️ The Timer')}</strong>
          <span className="art-card-sub">{tr('وقّف الساعة بالضبط', 'Stop the clock exactly')}</span>
          {snakeLocked ? <span className="art-card-pill">{tr('قريباً', 'Soon')}</span> : <span className="art-card-play">{tr('▶ العب', '▶ Play')}</span>}
        </button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
