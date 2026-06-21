import Board from '../components/Board';
import { homeTiles } from '../data/board';
import './page.css';

/**
 * Home board — the top level of Yasmin's device. Renders the seeded tile grid.
 * No back button here (home is the top level).
 */
export default function HomePage() {
  return (
    <main className="page">
      <Board tiles={homeTiles} />
    </main>
  );
}
