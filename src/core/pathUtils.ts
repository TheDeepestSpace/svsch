export interface OrthogonalPoint {
  x: number;
  y: number;
}

export function pathFromPoints(points: OrthogonalPoint[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`,
    )
    .join(' ');
}

export function formatPathNumber(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) < 0.01) {
    return String(rounded);
  }
  return Number(value.toFixed(3)).toString();
}
