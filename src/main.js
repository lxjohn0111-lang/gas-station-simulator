import { Game } from './game/game.js';
import { CrazyGames } from './core/sdk.js';

const TIPS = [
  'Tip: Release the pump right on the white line for a PERFECT FILL and a fat tip.',
  'Tip: Customers slip on oil. Mop it up… or grab some popcorn.',
  'Tip: Check the fuel colour! Diesel in a petrol car = KABOOM.',
  'Tip: Press F to shove. Great for shoplifters. Less great for reputation.',
  'Tip: Empty shelves make customers grumpy. Order stock on the tablet (TAB).',
  'Tip: Funny moments make your station go viral — more hype, more customers.',
  'Tip: Throw empty boxes into the dumpster with RMB.',
];

const fill = document.getElementById('load-fill');
const text = document.getElementById('load-text');
const tip = document.getElementById('load-tip');
tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
const tipTimer = setInterval(() => { tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 3500);

async function boot() {
  // SDK first (never blocks the game for long)
  await Promise.race([CrazyGames.init(), new Promise((r) => setTimeout(r, 4000))]);
  CrazyGames.loadingStart();
  const canvas = document.getElementById('game-canvas');
  let game;
  try {
    game = new Game(canvas);
    window.__game = game;
    await game.load((p, label) => {
      fill.style.width = Math.round(p * 100) + '%';
      if (label) text.textContent = label;
    });
  } catch (e) {
    console.error(e);
    text.textContent = 'Something went wrong while loading. Please refresh.';
    CrazyGames.loadingStop();
    return;
  }
  CrazyGames.loadingStop();
  clearInterval(tipTimer);
  const loading = document.getElementById('loading');
  loading.classList.add('fade');
  setTimeout(() => loading.remove(), 900);
  game.start();
}

boot();
