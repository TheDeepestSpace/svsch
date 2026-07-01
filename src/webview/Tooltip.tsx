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
  useRole
} from '@floating-ui/react';

export interface TooltipTriggerProps {
  ref: (node: HTMLElement | null) => void;
  [key: string]: unknown;
}

interface TooltipProps {
  content: React.ReactNode;
  placement?: Placement;
  // Render-prop trigger so the tooltip anchors the real element (e.g. the warning
  // icon) instead of an extra wrapper that would not inherit its positioning.
  children: (trigger: TooltipTriggerProps) => React.ReactNode;
}

const ARROW_WIDTH = 12;
const ARROW_HEIGHT = 6;
const TOOLTIP_BACKGROUND = 'rgba(0, 0, 0, 0.8)';

// The .svsch-tooltip border uses var(--svsch-error-highlight) (same red as the
// arm-block error highlight). SVG presentation attributes can't resolve CSS
// custom properties, so resolve the token to a concrete color for the arrow.
function useErrorHighlightColor(): string {
  const [color, setColor] = useState('#f14c4c');
  useLayoutEffect(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'display:none;color:var(--svsch-error-highlight)';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    if (resolved) setColor(resolved);
  }, []);
  return color;
}

// Screen-space tooltip. The reference element lives inside React Flow's zoomed
// ViewportPortal, so the floating bubble is portaled to <body> and positioned by
// Floating UI to avoid being scaled by the canvas zoom or clipped at its edges.
export function Tooltip({ content, placement = 'right', children }: TooltipProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);
  const borderColor = useErrorHighlightColor();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    middleware: [
      offset(ARROW_HEIGHT + 4),
      flip({ padding: 6 }),
      shift({ padding: 6 }),
      arrow({ element: arrowRef })
    ],
    whileElementsMounted: autoUpdate
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
            className="svsch-tooltip"
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
