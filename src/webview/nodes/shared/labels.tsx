import React from 'react';
import { getVscodeApi } from '../../vscodeApi';
import { normalizeWidth } from '../../../diagram/constants';
import {
  structFields,
  nodeModportName,
  repeatExpression,
  repeatExpressionSource,
} from '../../../ir/nodeMetadata';
import type {
  DiagramNode,
  DiagramPort,
  ParameterRef,
  ParameterDecl,
  InstanceParameter,
  SourceRange,
} from '../../../ir/types';

const vscode = getVscodeApi();

export function shouldLowerMuxTopPortLabel(node: DiagramNode, port: DiagramPort): boolean {
  return (
    node.kind === 'select' ||
    Boolean(normalizeWidth(port.width)) ||
    (node.kind === 'mux' &&
      (node.label.startsWith('if ') || (port.connectedSignal?.length ?? 0) > 24))
  );
}

export function TypeLabel({
  typeName,
  width,
  source,
  modportName,
  modportSource,
  parameterRefs,
}: {
  typeName?: string;
  width?: string;
  source?: any;
  modportName?: string;
  modportSource?: any;
  parameterRefs?: ParameterRef[];
}) {
  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleTypeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (source) {
      const msg = { type: 'navigateToSource', source };
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (typeName) {
    return (
      <span
        onClick={handleTypeClick}
        onDoubleClick={stopDrag}
        onMouseDown={stopDrag}
        onPointerDown={stopDrag}
        className="svsch-type-label nodrag nopan"
        style={{
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '0.9em',
          cursor: source ? 'pointer' : 'default',
          textDecoration: source ? 'underline' : 'none',
          textDecorationStyle: 'dotted',
          marginLeft: '4px',
          fontWeight: 'normal',
        }}
        title={source ? `Go to definition of ${typeName}` : undefined}
      >
        {typeName}
        {modportName && (
          <span
            onClick={(event) => {
              event.stopPropagation();
              if (modportSource) {
                const msg = { type: 'navigateToSource', source: modportSource };
                console.log('NAVIGATE:', JSON.stringify(msg));
                vscode.postMessage(msg);
              }
            }}
            className="svsch-modport-label nodrag nopan"
            style={{
              cursor: modportSource ? 'pointer' : 'default',
              textDecoration: modportSource ? 'underline' : 'none',
              textDecorationStyle: 'dotted',
            }}
            title={modportSource ? `Go to definition of ${modportName}` : undefined}
          >
            .{modportName}
          </span>
        )}
      </span>
    );
  }
  if (width) {
    return (
      <span style={{ marginLeft: '4px', fontWeight: 'normal' }}>
        <ParameterizedText text={width} refs={parameterRefs} />
      </span>
    );
  }
  return null;
}

export function navigateToSource(source: any): void {
  if (!source) return;
  const msg = { type: 'navigateToSource', source };
  console.log('NAVIGATE:', JSON.stringify(msg));
  vscode.postMessage(msg);
}

export function ParameterToken({
  text,
  refInfo,
}: {
  text: string;
  refInfo?: ParameterRef;
}): React.ReactElement {
  const source = refInfo?.declarationSource ?? refInfo?.source;
  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  if (!source) {
    return <span>{text}</span>;
  }

  return (
    <span
      className="svsch-param-token nodrag nopan"
      onClick={(event) => {
        event.stopPropagation();
        navigateToSource(source);
      }}
      onDoubleClick={stopDrag}
      onMouseDown={stopDrag}
      onPointerDown={stopDrag}
      title={`Go to definition of ${text}`}
    >
      {text}
    </span>
  );
}

export function ParameterizedText({
  text,
  refs = [],
}: {
  text: string;
  refs?: ParameterRef[];
}): React.ReactElement {
  if (refs.length === 0) {
    return <>{text}</>;
  }

  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return <>{text}</>;

  const pattern = new RegExp(
    `\\b(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'g',
  );
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const name = match[1];
    parts.push(<ParameterToken key={`${name}-${index}`} text={name} refInfo={byName.get(name)} />);
    lastIndex = index + name.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}

export type ParameterizedTextPart = string | { text: string; refInfo?: ParameterRef; key: string };

export function parameterizedTextParts(
  text: string,
  refs: ParameterRef[],
): ParameterizedTextPart[] {
  if (refs.length === 0) return [text];

  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return [text];

  const pattern = new RegExp(
    `\\b(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'g',
  );
  const parts: ParameterizedTextPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const name = match[1];
    parts.push({ key: `${name}-${index}`, text: name, refInfo: byName.get(name) });
    lastIndex = index + name.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

export function SvgParameterizedText({
  text,
  refs = [],
  onNavigateToSource,
}: {
  text: string;
  refs?: ParameterRef[];
  onNavigateToSource?: (source: SourceRange) => void;
}): React.ReactElement {
  const stopDrag = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };

  return (
    <>
      {parameterizedTextParts(text, refs).map((part, index) => {
        if (typeof part === 'string')
          return <React.Fragment key={`text-${index}`}>{part}</React.Fragment>;

        const source = part.refInfo?.declarationSource ?? part.refInfo?.source;
        if (!source) return <React.Fragment key={part.key}>{part.text}</React.Fragment>;

        return (
          <tspan
            key={part.key}
            className="svsch-param-token"
            onClick={(event) => {
              event.stopPropagation();
              onNavigateToSource?.(source);
            }}
            onDoubleClick={stopDrag}
            onMouseDown={stopDrag}
            onPointerDown={stopDrag}
          >
            {part.text}
          </tspan>
        );
      })}
    </>
  );
}

export function SvgParameterizedTextUnderlines({
  text,
  refs = [],
  x,
  y,
  fontSize,
  textWidth,
  className = '',
}: {
  text: string;
  refs?: ParameterRef[];
  x: number;
  y: number;
  fontSize: number;
  textWidth: (text: string) => number;
  className?: string;
}): React.ReactElement | null {
  let cursor = 0;
  const underlines = parameterizedTextParts(text, refs).flatMap((part, index) => {
    const partText = typeof part === 'string' ? part : part.text;
    const partWidth = textWidth(partText);
    if (typeof part === 'string') {
      cursor += partWidth;
      return [];
    }

    const source = part.refInfo?.declarationSource ?? part.refInfo?.source;
    if (!source) {
      cursor += partWidth;
      return [];
    }

    const x1 = x + cursor;
    cursor += partWidth;
    return [
      <line
        key={`param-underline-${part.key}-${index}`}
        className={`svsch-svg-link-underline svsch-param-token-underline ${className}`.trim()}
        x1={Math.round(x1)}
        x2={Math.round(x1 + partWidth)}
        y1={Math.round(y + fontSize * 0.62)}
        y2={Math.round(y + fontSize * 0.62)}
      />,
    ];
  });

  return underlines.length > 0 ? <>{underlines}</> : null;
}

export function ModuleParameterTable({
  moduleName,
  parameters = [],
}: {
  moduleName: string;
  parameters?: ParameterDecl[];
}): React.ReactElement | null {
  const metaParameters = parameters.filter((param) => param.kind === 'parameter');
  const localparams = parameters.filter((param) => param.kind === 'localparam');
  const title = moduleParameterTableTitle(moduleName);

  const renderRows = (items: ParameterDecl[]) =>
    items.map((param) => (
      <button
        key={`${param.kind}:${param.name}`}
        className="module-parameter-row"
        title={`${param.kind} ${param.name}${param.defaultValue ? ` = ${param.defaultValue}` : ''}`}
        onClick={() => navigateToSource(param.source)}
        disabled={!param.source}
      >
        <span className="module-parameter-name">{param.name}</span>
        <span className="module-parameter-default">{param.defaultValue ?? ''}</span>
      </button>
    ));

  return (
    <div className="module-parameter-table nodrag nopan" aria-label="Module parameters">
      <div className="module-parameter-line">
        <span>{title.label}: </span>
        <span className="module-parameter-mono">{title.name}</span>
      </div>
      {metaParameters.length > 0 && (
        <>
          <div className="module-parameter-rule" />
          <div className="module-parameter-section-title">Meta-parameters:</div>
          <div className="module-parameter-rows">{renderRows(metaParameters)}</div>
        </>
      )}
      {localparams.length > 0 && (
        <>
          <div className="module-parameter-rule" />
          <div className="module-parameter-section-title">Localparams:</div>
          <div className="module-parameter-rows">{renderRows(localparams)}</div>
        </>
      )}
    </div>
  );
}

export function moduleParameterTableTitle(moduleName: string): { label: string; name: string } {
  if (moduleName.startsWith('interface ')) {
    return { label: 'Interface', name: moduleName.slice('interface '.length) };
  }
  if (moduleName.startsWith('struct ')) {
    return { label: 'Struct', name: moduleName.slice('struct '.length) };
  }
  return { label: 'Module', name: moduleName };
}

export function InstanceParameterList({
  parameters = [],
}: {
  parameters?: InstanceParameter[];
}): React.ReactElement | null {
  if (parameters.length === 0) return null;

  return (
    <div className="instance-parameter-list">
      {parameters.map((param) => (
        <span
          key={param.name}
          className="instance-parameter-chip"
          title={`${param.name} = ${param.value ?? ''}`}
        >
          <span className="instance-parameter-name">{param.name}</span>
          {param.value && (
            <>
              <span className="instance-parameter-equals">=</span>
              <span className="instance-parameter-value">
                <ParameterizedText text={param.value} refs={param.parameterRefs} />
              </span>
            </>
          )}
        </span>
      ))}
    </div>
  );
}

export function RepeatLabel({ node }: { node: DiagramNode }) {
  const source = repeatExpressionSource(node);
  const expression = repeatExpression(node);
  const symbolicLabel = source && expression && node.label === `x ${expression}`;

  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (source) {
      const msg = { type: 'navigateToSource', source };
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (symbolicLabel) {
    return (
      <span className="svsch-repeat-label">
        <span>x </span>
        <span
          className="svsch-repeat-label-clickable nodrag nopan"
          onClick={handleClick}
          onMouseDown={stopDrag}
          onPointerDown={stopDrag}
          title={`Go to definition of ${expression}`}
        >
          {expression}
        </span>
      </span>
    );
  }

  return (
    <span className="svsch-repeat-label" onMouseDown={stopDrag} onPointerDown={stopDrag}>
      {node.label}
    </span>
  );
}
export function PortTypeSuffix({
  port,
}: {
  port: { width?: string; typeName?: string; modportName?: string };
}) {
  const isInterface = portIsInterfaceLike(port);
  const isStruct = !isInterface && port.typeName !== undefined;

  if (isInterface) {
    return <span className="svsch-port-type-suffix-blue">{'{}'}</span>;
  }
  if (isStruct) {
    return <span className="svsch-port-type-suffix">{'{}'}</span>;
  }
  return null;
}

export function PortLabel({
  port,
  showWidth = true,
  showType = true,
  collapseWidth = false,
}: {
  port: {
    name: string;
    label?: string;
    width?: string;
    widthExpression?: string;
    parameterRefs?: ParameterRef[];
    typeName?: string;
    typeSource?: any;
    modportName?: string;
    modportSource?: any;
  };
  showWidth?: boolean;
  showType?: boolean;
  collapseWidth?: boolean;
}) {
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const displayWidth = collapseWidth && width ? '[]' : width;
  const label =
    normalizeWidth(port.label ?? port.name) === undefined &&
    (port.label ?? port.name).startsWith('[')
      ? ''
      : (port.label ?? port.name);

  const isInterface = width === 'interface' || port.modportName !== undefined;
  const isStruct = !isInterface && port.typeName !== undefined;
  const renderType = showType && Boolean(port.typeName);

  if (label === '' && !showWidth) {
    const rawLabel = port.label ?? port.name;
    if (rawLabel === '[0:0]') return null;
    return <span>{rawLabel}</span>;
  }

  return (
    <span>
      {label}
      <PortTypeSuffix port={port} />
      {(showWidth &&
        !collapseWidth &&
        !isInterface &&
        !isStruct &&
        (port.typeName || displayWidth)) ||
      (!showWidth && renderType && !isInterface && !isStruct)
        ? ' '
        : ''}
      {showWidth &&
        !isInterface &&
        !isStruct &&
        (renderType ? (
          <TypeLabel
            typeName={port.typeName}
            width={displayWidth}
            source={port.typeSource}
            modportName={port.modportName}
            modportSource={port.modportSource}
          />
        ) : !port.typeName && displayWidth ? (
          collapseWidth ? (
            <span className="svsch-port-type-suffix">{displayWidth}</span>
          ) : (
            <span style={{ marginLeft: '4px', fontWeight: 'normal' }}>
              <ParameterizedText text={displayWidth} refs={port.parameterRefs} />
            </span>
          )
        ) : null)}
      {!showWidth && renderType && !isInterface && !isStruct && (
        <TypeLabel
          typeName={port.typeName}
          source={port.typeSource}
          modportName={port.modportName}
          modportSource={port.modportSource}
        />
      )}
    </span>
  );
}

function svgPortBaseLabel(port: DiagramPort, label?: string): string {
  const rawLabel = label ?? port.label ?? port.name;
  return normalizeWidth(rawLabel) === undefined && rawLabel.startsWith('[') ? '' : rawLabel;
}

function svgRawRangeLabel(rawLabel: string): string {
  const singletonRange = rawLabel.match(/^\[(\d+):\1\]$/);
  return singletonRange ? `[${singletonRange[1]}]` : rawLabel;
}

export function portIsInterfaceLike(port: {
  width?: string;
  widthExpression?: string;
  typeName?: string;
  modportName?: string;
}): boolean {
  const width = normalizeWidth(port.widthExpression ?? port.width);
  return (
    width === 'interface' ||
    port.modportName !== undefined ||
    Boolean(port.typeName && (port.typeName.endsWith('_if') || port.typeName.endsWith('if')))
  );
}

interface SvgPortLabelOptions {
  label?: string;
  showWidth?: boolean;
  showType?: boolean;
  collapseWidth?: boolean;
  hideInterfaceSuffix?: boolean;
  annotation?: string;
}

export function portDisplayLabel(port: DiagramPort, options: SvgPortLabelOptions = {}): string {
  const {
    label,
    showWidth = false,
    showType = true,
    collapseWidth = false,
    hideInterfaceSuffix = false,
    annotation,
  } = options;
  const rawLabel = label ?? port.label ?? port.name;
  const baseLabel = svgPortBaseLabel(port, label);
  const visibleBaseLabel = baseLabel === '' && !showWidth ? svgRawRangeLabel(rawLabel) : baseLabel;
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const isInterfacePort = portIsInterfaceLike(port);
  const showInterfaceSuffix = isInterfacePort && !hideInterfaceSuffix;
  const isStruct = !isInterfacePort && port.typeName !== undefined;
  const displayWidth = collapseWidth && width && width !== 'interface' ? '[]' : width;
  const typeOrWidth = showType ? port.typeName : undefined;

  let suffix = '';
  if (showInterfaceSuffix || isStruct) {
    suffix = '{}';
  } else if (!isInterfacePort && collapseWidth && showWidth && displayWidth) {
    suffix = displayWidth;
  } else if (!isInterfacePort && showWidth) {
    const visibleSuffix = typeOrWidth || displayWidth;
    if (visibleSuffix) suffix = ` ${visibleSuffix}`;
  }

  return visibleBaseLabel + suffix + (annotation ? ` ${annotation}` : '');
}

export function SvgPortLabel({
  port,
  label,
  showWidth = false,
  showType = true,
  collapseWidth = false,
  hideInterfaceSuffix = false,
}: {
  port: DiagramPort;
  label?: string;
  showWidth?: boolean;
  showType?: boolean;
  collapseWidth?: boolean;
  hideInterfaceSuffix?: boolean;
}) {
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const baseLabel = svgPortBaseLabel(port, label);
  const isInterfacePort = portIsInterfaceLike(port);
  const showInterfaceSuffix = isInterfacePort && !hideInterfaceSuffix;
  const isStruct = !isInterfacePort && port.typeName !== undefined;
  const displayWidth = collapseWidth && width && width !== 'interface' ? '[]' : width;
  const typeOrWidth = showType ? port.typeName : undefined;
  const visibleFullSuffix =
    !isInterfacePort && !isStruct && showWidth && !collapseWidth
      ? typeOrWidth || displayWidth
      : undefined;

  if (baseLabel === '' && !showWidth) {
    const rawLabel = port.label ?? port.name;
    return <>{svgRawRangeLabel(rawLabel)}</>;
  }

  return (
    <>
      {baseLabel}
      {showInterfaceSuffix ? (
        <tspan className="svsch-port-type-suffix-blue">{'{}'}</tspan>
      ) : isStruct ? (
        <tspan className="svsch-port-type-suffix">{'{}'}</tspan>
      ) : !isInterfacePort && collapseWidth && showWidth && displayWidth ? (
        <tspan className="svsch-port-type-suffix">{displayWidth}</tspan>
      ) : visibleFullSuffix ? (
        <tspan className="svsch-port-width-suffix"> {visibleFullSuffix}</tspan>
      ) : null}
    </>
  );
}

export function getSvgStructFieldAnnotation(
  node: DiagramNode,
  port: DiagramPort,
): string | undefined {
  const fields = structFields(node);
  const fieldName = port.label ?? port.name.split('.').pop();
  const field = fields.find((candidate) => candidate.name === fieldName);

  if (field && typeof field.typeName === 'string') {
    return field.typeName;
  }
  if (field && typeof field.bitRange === 'string') return field.bitRange;
  if (field && typeof field.width === 'string') return normalizeWidth(field.width);
  return normalizeWidth(port.width);
}

export function SvgStructFieldAnnotation({ node, port }: { node: DiagramNode; port: DiagramPort }) {
  const annotation = getSvgStructFieldAnnotation(node, port);
  if (!annotation) return null;
  return <tspan className="svsch-struct-field-annotation"> {annotation}</tspan>;
}

export function structFieldAnnotation(node: DiagramNode, port: DiagramPort): React.ReactNode {
  const fields = structFields(node);
  const fieldName = port.label ?? port.name.split('.').pop();
  const field = fields.find((candidate) => candidate.name === fieldName);

  if (field && typeof field.typeName === 'string') {
    return <TypeLabel typeName={field.typeName} />;
  }
  if (field && typeof field.bitRange === 'string') return field.bitRange;
  if (field && typeof field.width === 'string') return normalizeWidth(field.width);
  return normalizeWidth(port.width);
}

export function formatNodeKind(node: DiagramNode): string {
  if (node.kind === 'alu') return 'ALU';
  if (node.kind === 'inverter') return 'INVERTER';
  if (node.kind === 'comb') return 'COMBINATIONAL';
  if (node.kind === 'replicate') return node.label;
  if (node.kind === 'bus') return 'BUS';
  if (node.kind === 'struct') return 'STRUCT';
  if (node.kind === 'interface') return nodeModportName(node) ? 'MODPORT' : 'INTERFACE';
  if (node.kind === 'loop') return 'LOOP';
  if (node.kind === 'instance' && node.instanceOf) return node.instanceOf;
  return node.kind;
}

export function RegisterClockGlyph(): React.ReactElement {
  return (
    <svg className="register-clock-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M 1 1.5 L 9 6 L 1 10.5" />
    </svg>
  );
}
