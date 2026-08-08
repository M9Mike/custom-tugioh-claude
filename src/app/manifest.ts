import type { MetadataRoute } from 'next';

/** Lets both players add the duel to their iPhone home screen and play it
 *  fullscreen, without Safari's chrome eating the board. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shadow Duel',
    short_name: 'Shadow Duel',
    description: 'A two-player online duel between the original anime duelists.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0c11',
    theme_color: '#0a0c11',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
