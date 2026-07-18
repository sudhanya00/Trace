// Generates assets/splash-icon.png: the TRACE bike mark — geometric
// silhouette in signal yellow with the trace-line trailing behind it.
// Same visual language as the map puck. Run: node scripts/gen-splash.mjs
import sharp from 'sharp';

const YELLOW = '#FFD60A';
const LIGHT = '#FFF1A6';

const svg = `
<svg width="1024" height="1024" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0, 160)">
    <!-- the trace behind the bike: dotted where it's been -->
    <path d="M 30 570 C 120 572, 150 528, 225 512"
          stroke="${YELLOW}" stroke-width="16" fill="none" stroke-linecap="round"
          stroke-dasharray="1 52" opacity="0.9"/>
    <!-- wheels -->
    <circle cx="290" cy="470" r="92" stroke="${YELLOW}" stroke-width="30" fill="none"/>
    <circle cx="720" cy="470" r="92" stroke="${YELLOW}" stroke-width="30" fill="none"/>
    <!-- frame: every stroke lands on a hub or a node -->
    <path d="M 290 470 L 430 340
             M 620 285 L 720 470
             M 620 285 L 678 212"
          stroke="${YELLOW}" stroke-width="30" fill="none"
          stroke-linecap="round" stroke-linejoin="round"/>
    <!-- the body: one chunky tank-and-seat mass — this is what makes it a
         motorcycle and not a bicycle -->
    <path d="M 330 336 L 352 280 C 430 252, 552 244, 625 258 L 648 302
             C 640 312, 610 318, 585 322 L 540 330 C 470 342, 400 352, 356 352 Z"
          fill="${YELLOW}"/>
    <!-- headlight nub -->
    <circle cx="655" cy="270" r="20" fill="${LIGHT}"/>
  </g>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile('assets/splash-icon.png');
console.log('splash-icon.png written');

// A filled variant on black for the app icon foreground, while we're here.
const iconSvg = svg.replace('<svg ', '<svg style="background:#000" ');
await sharp(Buffer.from(iconSvg)).flatten({ background: '#000000' }).png().toFile('assets/icon.png');
await sharp(Buffer.from(svg)).png().toFile('assets/android-icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#000000' } })
  .png()
  .toFile('assets/android-icon-background.png');
console.log('icon set written');
