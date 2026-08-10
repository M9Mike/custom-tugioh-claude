import type { Metadata } from 'next';
import StoryMode from './StoryMode';

export const metadata: Metadata = {
  title: 'Story Mode · Shadow Duel',
  description: 'Make a duelist, cut your first deck, and walk out into the world.',
};

export default function Page() {
  return <StoryMode />;
}
