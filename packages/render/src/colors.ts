import React from 'react';

const ESC = '\x1b';

export function bold(str: string): string {
  return `${ESC}[1m${str}${ESC}[22m`;
}

export function dim(str: string): string {
  return `${ESC}[2m${str}${ESC}[22m`;
}

export function dimmer(str: string): string {
  return dim(str);
}

export function underline(str: string): string {
  return `${ESC}[4m${str}${ESC}[24m`;
}

export function strikethrough(str: string): string {
  return `${ESC}[9m${str}${ESC}[29m`;
}

export function invert(str: string): string {
  return `${ESC}[7m${str}${ESC}[27m`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

export function color(str: string, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${ESC}[38;2;${r};${g};${b}m${str}${ESC}[39m`;
}

export function bgColor(str: string, hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${ESC}[48;2;${r};${g};${b}m${str}${ESC}[49m`;
}

export function link(str: string, url: string): string {
  return `${ESC}]8;;${url}${ESC}\\${str}${ESC}]8;;${ESC}\\`;
}

export function renderChildren(children: React.ReactNode): string {
  const parts: string[] = [];
  React.Children.forEach(children, (child) => {
    if (typeof child === 'string') parts.push(child);
    else if (typeof child === 'number') parts.push(String(child));
    else if (typeof child === 'boolean' || child === null || child === undefined) {
      // skip
    } else if (typeof child === 'object' && '$$typeof' in child) {
      const el = child as React.ReactElement<{ children?: React.ReactNode }>;
      parts.push(React.Children.toArray(el.props?.children || '').join('') as string);
    }
  });
  return parts.join('');
}
