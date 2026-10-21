import { useEffect, useState, type MouseEvent } from 'react';

export type ItemMenuAction = { label: string; danger?: boolean; run: () => void };

/** 우클릭 메뉴 상태. open(e, actions)을 onContextMenu에서 부르고, 반환된 menu를 <ItemMenu>에 넘긴다 */
export function useItemMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: ItemMenuAction[] } | null>(
    null,
  );
  const open = (e: MouseEvent, actions: ItemMenuAction[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, actions });
  };
  return { menu, open, close: () => setMenu(null) };
}

/** 바깥 클릭 · Esc · 창 포커스 이탈로 닫힌다 */
export function ItemMenu({
  menu,
  onClose,
}: {
  menu: { x: number; y: number; actions: ItemMenuAction[] } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  return (
    <div
      className="pane-menu"
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className={a.danger ? 'danger' : undefined}
          onClick={() => {
            onClose();
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
