import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { DiagramPort } from '../../../ir/types';
import { isInoutPort } from '../../../diagram/portDirection';

/**
 * Handle(s) for a port on a node's input side. Ordinary input ports get a
 * single target handle; inout ports reuse that same physical pin for a
 * source handle too, so a bidirectional signal can both drive and be read
 * from the one visual connection point instead of pretending it's input-only.
 */
export function InputPortHandles({
  port,
  position,
  style
}: {
  port: DiagramPort;
  position: Position;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <>
      <Handle type="target" id={port.id} position={position} style={style} />
      {isInoutPort(port) && <Handle type="source" id={port.id} position={position} style={style} />}
    </>
  );
}
