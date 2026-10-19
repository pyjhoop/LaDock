import { useEffect, useRef } from 'react';

/**
 * 버튼 안에 input을 넣으면 Space가 버튼을 눌러버려서, 버튼을 대신 렌더하는 형제 input.
 * Enter = 저장, Esc = 취소, blur = 저장.
 */
export function InlineRename({
  value,
  placeholder,
  onDone,
}: {
  value: string;
  placeholder?: string;
  /** text가 null이면 취소 */
  onDone: (text: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => ref.current?.select(), []);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
    // 입력이 가져간 키 포커스를 터미널에 돌려준다
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('.pane.focused .xterm-helper-textarea')?.focus(),
    );
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      autoFocus
      defaultValue={value}
      placeholder={placeholder}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
