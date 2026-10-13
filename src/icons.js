// Small inline SVG icons for the HUD, the menus, and the map legend. Each returns markup
// built only from constants and colors in this file or map.js, never from player text.

const svg = (body, label = '', vb = '0 0 24 24') =>
  `<svg class="icon" viewBox="${vb}" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">${body}</svg>`;

// Shamus's head: a tan fedora over a robot face with a dark visor.
export const head = (label = '') =>
  svg(
    `<path d="M3 12.2c2.6-1.1 15.4-1.1 18 0l-.6 1.6c-3-.9-13.8-.9-16.8 0z" fill="#e2ad62"/>
     <path d="M7 12 8.2 5.2c.2-.9 1-1.4 1.8-1.1l2 .7 2-.7c.8-.3 1.6.2 1.8 1.1L17 12z" fill="#c98a3c"/>
     <path d="M7.4 9.6h9.2l.3 1.8H7.1z" fill="#3b2614"/>
     <rect x="7.2" y="13.6" width="9.6" height="7.6" rx="3" fill="#e9e3d6"/>
     <rect x="8.4" y="15.6" width="7.2" height="2.4" rx="1.2" fill="#12151c"/>
     <circle cx="10.2" cy="16.8" r=".6" fill="#ffd23f"/><circle cx="13.8" cy="16.8" r=".6" fill="#ffd23f"/>`,
    label,
  );

export const key = (color, label = '') =>
  svg(
    `<circle cx="7" cy="12" r="4.4" fill="none" stroke="${color}" stroke-width="2.6"/>
     <path d="M11 10.7h10.2v2.6H19v3.2h-2.6v-3.2h-1.6v2.4h-2.6v-2.4H11z" fill="${color}"/>`,
    label,
  );

export const keyhole = (color, label = '') =>
  svg(
    `<rect x="4" y="3" width="16" height="18" rx="3" fill="#1b1f29" stroke="${color}" stroke-width="2"/>
     <circle cx="12" cy="10" r="2.8" fill="${color}"/><path d="M10.6 11.5h2.8l1 6h-4.8z" fill="${color}"/>`,
    label,
  );

export const mystery = (label = '') =>
  svg(
    `<circle cx="12" cy="12" r="10" fill="#2a1e05" stroke="#ffc83d" stroke-width="2"/>
     <path d="M9 9.2a3.1 3.1 0 1 1 4.6 2.7c-1 .6-1.4 1.1-1.4 2.3" fill="none" stroke="#ffc83d" stroke-width="2.4" stroke-linecap="round"/>
     <circle cx="12.2" cy="17.6" r="1.4" fill="#ffc83d"/>`,
    label,
  );

export const life = (label = '') =>
  svg(
    `<rect x="9" y="2.5" width="6" height="3" rx="1" fill="#9aa3ad"/>
     <path d="M9.6 5.5h4.8v3.2c2.6 1 4.1 3.2 4.1 6.1 0 3.9-2.8 6.7-6.5 6.7s-6.5-2.8-6.5-6.7c0-2.9 1.5-5.1 4.1-6.1z" fill="#123d22" stroke="#46e07c" stroke-width="1.6"/>
     <path d="M7.4 14.5h9.2c-.2 3-2.1 5-4.6 5s-4.4-2-4.6-5z" fill="#46e07c"/>
     <circle cx="10.4" cy="12" r="1" fill="#9df5bd"/><circle cx="13.4" cy="10.4" r=".7" fill="#9df5bd"/>`,
    label,
  );

export const droid = (dome = '#eef0f2') =>
  svg(
    `<path d="M5 13a7 7 0 0 1 14 0z" fill="${dome}"/><rect x="4.5" y="12.6" width="15" height="2.6" rx="1" fill="#a9b0b8"/>
     <circle cx="12" cy="9.6" r="2.2" fill="#ff3b30"/>
     <path d="M6 15.2 4 20M9.5 15.2 9 20.5M14.5 15.2l.5 5.3M18 15.2l2 4.8" stroke="#a9b0b8" stroke-width="1.6" stroke-linecap="round"/>`,
  );

export const drone = () =>
  svg(
    `<ellipse cx="12" cy="13.5" rx="9.5" ry="3.6" fill="#173b44" stroke="#3fe0f0" stroke-width="1.6"/>
     <path d="M12 13.5 4 9.5M12 13.5l8-4M12 13.5l-6 5M12 13.5l6 5" stroke="#3fe0f0" stroke-width="1.2"/>
     <circle cx="12" cy="11.4" r="3" fill="#3fe0f0"/>`,
  );

export const jumper = () =>
  svg(
    `<ellipse cx="12" cy="12" rx="7" ry="4.6" fill="#2fbf5a"/>
     <circle cx="8.8" cy="8.4" r="2" fill="#2fbf5a"/><circle cx="15.2" cy="8.4" r="2" fill="#2fbf5a"/>
     <circle cx="8.8" cy="8.2" r=".9" fill="#ffd23f"/><circle cx="15.2" cy="8.2" r=".9" fill="#ffd23f"/>
     <path d="M5.5 14 3 19h4M18.5 14l2.5 5h-4" fill="none" stroke="#8de0a4" stroke-width="1.6" stroke-linejoin="round"/>`,
  );

export const sniffer = () =>
  svg(
    `<rect x="4" y="9.5" width="11" height="6" rx="2.5" fill="#7b5cff"/>
     <path d="M14 11h7.5l-1 2.6H14z" fill="#b8a6ff"/><circle cx="21" cy="12.3" r="1" fill="#ff3b30"/>
     <path d="M6 15.5 5 19.5M9 15.5v4M12 15.5l1 4" stroke="#b8a6ff" stroke-width="1.6" stroke-linecap="round"/>`,
  );

export const warden = () =>
  svg(
    `<rect x="7" y="16" width="10" height="5" rx="1" fill="#6b4a22"/>
     <circle cx="12" cy="12" r="5.4" fill="#ff8a2a"/>
     <path d="M12 12V3.5M12 12l6-6M12 12l-6-6" stroke="#ffc48a" stroke-width="2" stroke-linecap="round"/>
     <circle cx="12" cy="12" r="2" fill="#2a1406"/>`,
  );

export const shadow = () =>
  svg(
    `<path d="M3.5 9.6c3-1.4 14-1.4 17 0l-.4 1.4c-3.5-.8-12.7-.8-16.2 0z" fill="#3b2a66"/>
     <path d="M7.6 9.4 8.6 4c.2-.8.9-1.2 1.7-1l1.7.5 1.7-.5c.8-.2 1.5.2 1.7 1l1 5.4z" fill="#3b2a66"/>
     <path d="M5 22c.4-6 2.6-10.6 7-10.6S18.6 16 19 22z" fill="#2a1d4d" stroke="#8f7bff" stroke-width="1"/>
     <path d="M8.8 13.6h2.6M12.6 13.6h2.6" stroke="#ffe14d" stroke-width="1.6" stroke-linecap="round"/>`,
  );
