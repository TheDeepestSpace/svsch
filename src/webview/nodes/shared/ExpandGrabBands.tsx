import React from 'react';
import type { ExpandContentInsets } from '../../expand/splice';

/**
 * While a node is an expanded instance's dimmed frame, its wrapper is
 * pointer-transparent (see the .hdl-node-expand-ghost rules in diagram.css)
 * so the sub-diagram area inside behaves like ordinary canvas — middle-drag
 * pans, clicks fall through to the pane. These four bands cover the frame's
 * reserved border ring (header/parameter rows, boundary-label columns,
 * bottom inset — see ExpandContentInsets in expand/splice.ts) and re-enable
 * the pointer there, so the ring is the only place the frame itself can be
 * selected or dragged from. The ring carries the ghost's translucent
 * backdrop and its inner boundary is drawn as a visible border (the
 * interior stays fully transparent so spliced wires render at full
 * brightness — see the .hdl-node-expand-ghost rules).
 */
export function ExpandGrabBands({
  insets,
}: {
  insets: ExpandContentInsets;
}): React.ReactElement {
  return (
    <React.Fragment>
      <div
        className="svsch-expand-grab-band"
        style={{ top: 0, left: 0, right: 0, height: insets.top }}
      />
      <div
        className="svsch-expand-grab-band"
        style={{ top: insets.top, bottom: insets.bottom, left: 0, width: insets.left }}
      />
      <div
        className="svsch-expand-grab-band"
        style={{ top: insets.top, bottom: insets.bottom, right: 0, width: insets.right }}
      />
      <div
        className="svsch-expand-grab-band"
        style={{ bottom: 0, left: 0, right: 0, height: insets.bottom }}
      />
      <div
        className="svsch-expand-content-border"
        aria-hidden="true"
        style={{
          top: insets.top,
          left: insets.left,
          right: insets.right,
          bottom: insets.bottom,
        }}
      />
    </React.Fragment>
  );
}
