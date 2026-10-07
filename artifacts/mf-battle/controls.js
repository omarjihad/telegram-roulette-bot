// The in-game controls a player can move, resize and fade in "Control settings".
// x / y are the control's centre as a fraction of the (landscape) screen; w / h are its
// size in pixels at scale 1.

export const CONTROLS = [
  { id: 'joystick', name: 'الجويستك', shape: 'round', w: 132, h: 132, x: 0.15, y: 0.72, label: '' },
  { id: 'split', name: 'انقسام', shape: 'round', w: 88, h: 88, x: 0.9, y: 0.78, label: 'انقسام' },
  { id: 'throw', name: 'رمي', shape: 'round', w: 72, h: 72, x: 0.78, y: 0.88, label: 'رمي' },
  { id: 'double', name: 'سرعة الرمي ×2', shape: 'round', w: 60, h: 60, x: 0.92, y: 0.56, label: '2x' },
  { id: 'chat', name: 'الشات', shape: 'box', w: 220, h: 78, x: 0.2, y: 0.14, label: 'اكتب رسالة…' },
  { id: 'leaderboard', name: 'المتصدرين', shape: 'box', w: 150, h: 132, x: 0.88, y: 0.22, label: 'المتصدرين' },
  { id: 'mass', name: 'الكتلة', shape: 'pill', w: 150, h: 36, x: 0.5, y: 0.07, label: 'الكتلة: 0' },
  { id: 'minimap', name: 'الخريطة', shape: 'box', w: 92, h: 92, x: 0.07, y: 0.38, label: 'الخريطة' },
  { id: 'zoom', name: 'التقريب', shape: 'pill-v', w: 44, h: 96, x: 0.04, y: 0.62, label: '+ −' },
];

export const byId = Object.fromEntries(CONTROLS.map((c) => [c.id, c]));

/** The full layout: saved values over the defaults, every control present. */
export function fullLayout(saved = {}) {
  const out = {};
  for (const c of CONTROLS) {
    const s = saved[c.id] || {};
    out[c.id] = {
      x: Number.isFinite(s.x) ? s.x : c.x,
      y: Number.isFinite(s.y) ? s.y : c.y,
      s: Number.isFinite(s.s) ? s.s : 1,
      o: Number.isFinite(s.o) ? s.o : 1,
    };
  }
  return out;
}

export function defaultLayout() {
  return fullLayout({});
}

/** Inner look of one control (used by the editor and the shared picture). */
export function controlHTML(c) {
  if (c.id === 'joystick') return '<span class="ctl-joy-base"><span class="ctl-joy-knob"></span></span>';
  if (c.id === 'leaderboard') return '<span class="ctl-lb"><b>المتصدرين</b><i>1. MF</i><i>2. ···</i><i>3. ···</i></span>';
  if (c.id === 'minimap') return '<span class="ctl-map"><i></i></span>';
  if (c.id === 'zoom') return '<span class="ctl-zoom"><b>+</b><b>−</b></span>';
  return `<span class="ctl-label">${c.label}</span>`;
}

/**
 * Draws the layout as a picture (sent with the copied code by the bot).
 * Returns a JPEG data URL.
 */
export function layoutPicture(layout, width = 960, height = 444) {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const g = cv.getContext('2d');
  const bg = g.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#120a26');
  bg.addColorStop(1, '#0a1630');
  g.fillStyle = bg;
  g.fillRect(0, 0, width, height);
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let x = 0; x < width; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, height); g.stroke(); }
  for (let y = 0; y < height; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(width, y); g.stroke(); }
  // The picture is drawn for a 960×444 screen; controls keep their real proportions.
  const k = width / 960;
  for (const c of CONTROLS) {
    const p = layout[c.id];
    const w = c.w * p.s * k, h = c.h * p.s * k;
    const cx = p.x * width, cy = p.y * height;
    g.globalAlpha = p.o;
    g.fillStyle = c.id === 'split' ? '#ff3b6b' : c.id === 'throw' ? '#ff8a3d' : c.id === 'double' ? '#9b5cff' : 'rgba(255,255,255,0.14)';
    g.strokeStyle = '#ffd34d';
    g.lineWidth = 2;
    g.setLineDash([6, 5]);
    g.beginPath();
    if (c.shape === 'round') g.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    else g.roundRect(cx - w / 2, cy - h / 2, w, h, c.shape === 'box' ? 12 * k : Math.min(w, h) / 2);
    g.fill();
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.max(11, 15 * k * Math.min(1.3, p.s))}px Cairo, Tahoma, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(c.name, cx, cy);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#ffd34d';
  g.font = `bold ${18 * k}px Cairo, Tahoma, sans-serif`;
  g.textAlign = 'left';
  g.fillText('MF Battle', 16 * k, height - 18 * k);
  return cv.toDataURL('image/jpeg', 0.85);
}
