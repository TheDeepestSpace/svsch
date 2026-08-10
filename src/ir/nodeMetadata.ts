import type { DiagramNode, DiagramNodeMetadata, SourceRange, StructField } from './types';

export function nodeExpression(node: DiagramNode): string | undefined {
  return node.expression ?? node.metadata?.expression;
}

export function nodeOperation(node: DiagramNode): string | undefined {
  return node.operation ?? node.metadata?.operation;
}

/** Gate body shape ('and' | 'or' | 'xor') independent of whether the output is negated. */
export function gateBodyOperation(node: DiagramNode): 'and' | 'or' | 'xor' {
  const op = nodeOperation(node);
  if (op === 'nand') return 'and';
  if (op === 'nor') return 'or';
  if (op === 'xnor') return 'xor';
  if (op === 'and' || op === 'or' || op === 'xor') return op;
  return 'and';
}

export function gateIsNegated(node: DiagramNode): boolean {
  const op = nodeOperation(node);
  return op === 'nand' || op === 'nor' || op === 'xnor';
}

export function nodeReason(node: DiagramNode): string | undefined {
  return node.reason ?? node.metadata?.reason;
}

export function nodeWidth(node: DiagramNode): string | undefined {
  return node.width ?? node.metadata?.width;
}

export function nodePreferredSide(node: DiagramNode): string | undefined {
  return node.preferredSide ?? node.metadata?.preferredSide;
}

export function nodeTypeName(node: DiagramNode): string | undefined {
  return node.typeName ?? node.metadata?.typeName;
}

export function nodeTypeSource(node: DiagramNode): SourceRange | undefined {
  return node.typeSource ?? node.metadata?.typeSource;
}

export function nodeModportName(node: DiagramNode): string | undefined {
  return node.modportName ?? node.metadata?.modportName;
}

export function nodeModportSource(node: DiagramNode): SourceRange | undefined {
  return node.modportSource ?? node.metadata?.modportSource;
}

export function nodeIsProcedural(node: DiagramNode): boolean {
  return node.isProcedural === true || node.metadata?.isProcedural === true;
}

export function nodeIsInferred(node: DiagramNode): boolean {
  return node.inferred === true || node.metadata?.inferred === true;
}

export function registerClockSignal(node: DiagramNode): string | undefined {
  return node.kind === 'register' ? node.clockSignal ?? node.metadata?.clockSignal : undefined;
}

export function registerResetSignal(node: DiagramNode): string | undefined {
  return node.kind === 'register' ? node.resetSignal ?? node.metadata?.resetSignal : undefined;
}

export function registerResetActiveLow(node: DiagramNode): boolean {
  return node.kind === 'register' && (node.resetActiveLow === true || node.metadata?.resetActiveLow === true);
}

export function structRole(node: DiagramNode): DiagramNodeMetadata['role'] {
  return node.kind === 'struct' || node.kind === 'bus' || node.kind === 'interface' ? node.role ?? node.metadata?.role : undefined;
}

export function structFields(node: DiagramNode): StructField[] {
  return node.kind === 'struct' || node.kind === 'interface'
    ? (Array.isArray(node.fields) ? node.fields : Array.isArray(node.metadata?.fields) ? node.metadata.fields : [])
    : [];
}

export function repeatExpression(node: DiagramNode): string | undefined {
  return node.kind === 'replicate' ? node.repeatExpression ?? node.metadata?.repeatExpression : undefined;
}

export function repeatExpressionSource(node: DiagramNode): SourceRange | undefined {
  return node.kind === 'replicate' ? node.repeatExpressionSource ?? node.metadata?.repeatExpressionSource : undefined;
}

export function nodeIsArrayNode(node: DiagramNode): boolean {
  return node.isArrayNode === true || node.metadata?.isArrayNode === true;
}

export function nodeArrayDimension(node: DiagramNode): string | undefined {
  return node.arrayDimension ?? node.metadata?.arrayDimension;
}

export function nodeArraySize(node: DiagramNode): number | undefined {
  return node.arraySize ?? node.metadata?.arraySize;
}
