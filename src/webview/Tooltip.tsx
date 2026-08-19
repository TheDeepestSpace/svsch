import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingPortal,
  offset,
  type Placement,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from '@floating-ui/react';

export interface TooltipTriggerProps {
  ref: (node: HTMLElement | null) => void;
  [key: string]: unknown;
}

interface TooltipProps {
  content: React.ReactNode;
  placement?: Placement;
  // 'warning' (default) borrows the error-highlight red used for actual
  // warning/error icons; 'info' is for plain informational popovers (e.g.
  // "Also declared as: ...") that aren't flagging a problem.
  tone?: 'warning' | 'info';
  // Render-prop trigger so the tooltip anchors the real element (e.g. the warning
  // icon) instead of an extra wrapper that would not inherit its positioning.
  children: (trigger: TooltipTriggerProps) => React.ReactNode;
}

const ARROW_WIDTH = 12;
const ARROW_HEIGHT = 6;
const TOOLTIP_BACKGROUND = 'rgba(0, 0, 0, 0.8)';

// The .svsch-tooltip border resolves to a CSS custom property (error-highlight
// red for 'warning', panel-border for 'info'). SVG presentation attributes
// can't resolve CSS custom properties, so resolve to a concrete color here
// for the arrow, matching whichever border the CSS class above applies.
function useTooltipBorderColor(tone: 'warning' | 'info'): string {
  const token = tone === 'info' ? '--vscode-panel-border' : '--svsch-error-highlight';
  const fallback = tone === 'info' ? '#454545' : '#f14c4c';
  const [color, setColor] = useState(fallback);
  useLayoutEffect(() => {
    const probe = document.createElement('span');
    probe.style.cssText = `display:none;color:var(${token})`;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    if (resolved) setColor(resolved);
  }, [token]);
  return color;
}

// Screen-space tooltip. The reference element lives inside React Flow's zoomed
// ViewportPortal, so the floating bubble is portaled to <body> and positioned by
// Floating UI to avoid being scaled by the canvas zoom or clipped at its edges.
export function Tooltip({
  content,
  placement = 'right',
  tone = 'warning',
  children,
}: TooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const borderColor = useTooltipBorderColor(tone);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [
      offset(ARROW_HEIGHT + 4),
      flip({ padding: 6 }),
      shift({ padding: 6 }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  });

  const hover = useHover(context, { move: false, delay: { open: 0, close: 0 } });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);

  return (
    <>
      {children({ ref: refs.setReference, ...getReferenceProps() })}
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={`svsch-tooltip${tone === 'info' ? ' svsch-tooltip-info' : ''}`}
            style={floatingStyles}
            {...getFloatingProps()}
          >
            {content}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              width={ARROW_WIDTH}
              height={ARROW_HEIGHT}
              fill={TOOLTIP_BACKGROUND}
              stroke={borderColor}
              strokeWidth={1}
            />
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
