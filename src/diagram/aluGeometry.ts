// ALU input anchors: first input at one grid unit down, second at three grid
// units down. Shared by AluNode (HTML handles) and AluNodeSvg (drawn leads)
// so the two stay aligned.
export function aluInputPortTops(gridSize: number): [number, number] {
  return [gridSize, gridSize * 3];
}
