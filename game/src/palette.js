// The look plan, in one place. A dusk desert yard: warm dark ground, sandstone walls,
// one amber accent for the player's team and the A site, teal for B, crimson for the enemy.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191512',
  surface: '#2b251d',
  hairline: '#453b2c',
  ink: '#ece5d8',
  muted: '#9a8f7d',
  accent: '#e8a020',
  ally: '#4db6a6',
  enemy: '#c94f42',
  siteB: '#4db6a6',
};

export function shade(name) {
  return PALETTE[name];
}
