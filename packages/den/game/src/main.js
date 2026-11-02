import { lookdev } from './lookdev.js';
import { game } from './game.js';

const canvas = document.getElementById('stage');
if (location.hash === '#lookdev') {
  for (const el of document.querySelectorAll('.top, .bottom, #loading')) el.hidden = true;
  lookdev(canvas);
} else {
  game(canvas);
}
