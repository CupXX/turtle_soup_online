import { GameClient } from '@/components/game/game-client';
import { demoSnapshot } from '@/lib/demo-snapshot';

export default function HomePage() {
  return <GameClient initialSnapshot={demoSnapshot} demo />;
}
