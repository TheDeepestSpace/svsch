export interface OrthogonalPoint {
  x: number;
  y: number;
}

export function pathFromPoints(points: OrthogonalPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}
