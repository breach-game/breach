import { Children, cloneElement, isValidElement, type ReactNode, useLayoutEffect, useRef } from 'react';

/** The characters a rendered message shows, in reading order. */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/**
 * A message being typed out: its first `shown` characters, the caret, then the rest kept in the
 * layout but invisible. Lines therefore break where they will in the final message from the first
 * character on, so no word jumps from one line to another while it is typed.
 */
export function reveal(node: ReactNode, shown: number): ReactNode {
  let left = shown;
  let caretPlaced = false;
  const caret = () => {
    caretPlaced = true;
    return <span className="caret" key="caret" />;
  };
  const walk = (n: ReactNode, key: string | number, inside = false): ReactNode => {
    if (typeof n === 'string' || typeof n === 'number') {
      const s = String(n);
      if (left >= s.length) {
        left -= s.length;
        return s;
      }
      const head = s.slice(0, left);
      left = 0;
      return [
        // Inside a `code` span or a flag, the typed part carries the background (see `.typing`).
        inside && head ? (
          <span className="typed" key={`typed-${key}`}>
            {head}
          </span>
        ) : (
          head
        ),
        caretPlaced ? null : caret(),
        <span className="untyped" key={`untyped-${key}`}>
          {s.slice(head.length)}
        </span>,
      ];
    }
    if (Array.isArray(n)) return n.map((c, i) => walk(c, `${key}.${i}`, inside));
    if (isValidElement<{ children?: ReactNode; className?: string }>(n)) {
      // Nothing of it shown yet: hide the whole box, background and border included.
      if (left === 0 && caretPlaced)
        return (
          <span className="untyped" key={`untyped-${key}`}>
            {n}
          </span>
        );
      const before = caretPlaced;
      const children = Children.toArray(n.props.children).map((c, i) => walk(c, i, true));
      // Being typed: its own background would show the room kept for what is not typed yet.
      const typing = caretPlaced && !before;
      const className = typing ? `${n.props.className ?? ''} typing`.trim() : n.props.className;
      return cloneElement(n, { className }, children);
    }
    return n;
  };
  const out = walk(node, 'r');
  return caretPlaced ? out : [out, caret()];
}

/**
 * The paragraph of a message being typed out. It is laid out whole (see `reveal`) but only as tall
 * as the lines reached so far, so it grows line by line as the text arrives.
 */
export function Typing({ children, shown }: { children: ReactNode; shown: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: measure again at every step
  useLayoutEffect(() => {
    const p = ref.current;
    const caret = p?.querySelector('.caret');
    if (!p || !caret) return;
    const css = getComputedStyle(p);
    const px = (v: string) => Number.parseFloat(v) || 0;
    const above = px(css.borderTopWidth) + px(css.paddingTop);
    const below = px(css.borderBottomWidth) + px(css.paddingBottom);
    const top = p.getBoundingClientRect().top + above;
    const at = caret.getBoundingClientRect();
    const line = Number.parseFloat(css.lineHeight);
    // Whole lines where the paragraph's own line height applies, the caret's foot elsewhere.
    const text =
      Number.isFinite(line) && !caret.closest('.paste')
        ? (Math.floor((at.top + at.height / 2 - top) / line) + 1) * line
        : at.bottom - top + 1;
    const height = css.boxSizing === 'border-box' ? text + above + below : text;
    p.style.maxHeight = `${Math.ceil(height)}px`;
  }, [shown]);
  return (
    <p className="typing-p" ref={ref}>
      {reveal(children, shown)}
    </p>
  );
}
