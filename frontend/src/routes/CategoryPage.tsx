import { useParams } from 'react-router-dom';
import Board from '../components/Board';
import { findCategory } from '../data/board';
import type { Tile } from '../types';
import './page.css';

/**
 * Category drill-down page. Reads `:categoryId` and renders that category's
 * children as a freely-placed board. The back ("Terug") tile is part of each
 * sub-page's tile data (top-right), so it is positioned like the device.
 */
export default function CategoryPage() {
  const { categoryId } = useParams();
  const category = findCategory(categoryId);
  const children: Tile[] = category?.children ?? [];

  // Empty categories still get a back tile so she is never stuck.
  const fallback: Tile[] = [
    ...(category?.symbolKeyword
      ? [{ id: 'empty', kind: 'system', label: category.label, symbolKeyword: category.symbolKeyword, layout: { col: 1, row: 1 } } as Tile]
      : []),
    { id: 'back', kind: 'back', label: 'Terug', layout: { col: 2, row: 1 } },
  ];

  return (
    <main className="page">
      <Board tiles={children.length > 0 ? children : fallback} />
    </main>
  );
}
