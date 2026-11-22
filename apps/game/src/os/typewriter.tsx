import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

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
  const walk = (n: ReactNode, key: string | number): ReactNode => {
    if (typeof n === 'string' || typeof n === 'number') {
      const s = String(n);
      if (left >= s.length) {
        left -= s.length;
        return s;
      }
      const head = s.slice(0, left);
      left = 0;
      return [
        head,
        caretPlaced ? null : caret(),
        <span className="ghost" key={`ghost-${key}`}>
          {s.slice(head.length)}
        </span>,
      ];
    }
    if (Array.isArray(n)) return n.map((c, i) => walk(c, `${key}.${i}`));
    if (isValidElement<{ children?: ReactNode }>(n)) {
      // Nothing of it shown yet: hide the whole box, background and border included.
      if (left === 0 && caretPlaced)
        return (
          <span className="ghost" key={`ghost-${key}`}>
            {n}
          </span>
        );
      const children = Children.toArray(n.props.children).map((c, i) => walk(c, i));
      return cloneElement(n as ReactElement<{ children?: ReactNode }>, undefined, children);
    }
    return n;
  };
  const out = walk(node, 'r');
  return caretPlaced ? out : [out, caret()];
}
