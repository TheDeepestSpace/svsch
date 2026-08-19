import { describe, expect, it } from 'vitest';
import { generateArmSpan } from '../../src/diagram/generateArmSpan';

// Mirrors test/fixtures/generate_regions.sv line numbering (1-based lines, 0-based cols),
// matching the ranges the UHDM backend emits for that fixture.
const TEXT = [
  /* 1*/ 'module leaf(input logic a, output logic y);',
  /* 2*/ '  assign y = a;',
  /* 3*/ 'endmodule',
  /* 4*/ '',
  /* 5*/ 'module generate_regions #(',
  /* 6*/ '  parameter ENABLE = 1,',
  /* 7*/ '  parameter MODE = 0',
  /* 8*/ ') (',
  /* 9*/ '  input logic a,',
  /*10*/ '  input logic b,',
  /*11*/ '  input logic c,',
  /*12*/ '  output logic y',
  /*13*/ ');',
  /*14*/ '  logic w;',
  /*15*/ '',
  /*16*/ '  generate',
  /*17*/ '    if (ENABLE == 0) begin : g_if_zero',
  /*18*/ '      leaf u_zero(.a(a), .y(w));',
  /*19*/ '    end else if (ENABLE == 1) begin : g_if_one',
  /*20*/ '      case (MODE)',
  /*21*/ '        0: begin : g_case_0',
  /*22*/ '          leaf u_case_0(.a(a), .y(w));',
  /*23*/ '        end',
  /*24*/ '        1: begin : g_case_1',
  /*25*/ '          leaf u_case_1(.a(b), .y(w));',
  /*26*/ '        end',
  /*27*/ '        default: begin : g_case_default',
  /*28*/ '          assign w = c;',
  /*29*/ '        end',
  /*30*/ '      endcase',
  /*31*/ '    end else begin : g_if_other',
  /*32*/ "      assign w = 1'b0;",
  /*33*/ '    end',
  /*34*/ '  endgenerate',
  /*35*/ '',
  /*36*/ '  assign y = w;',
  /*37*/ 'endmodule',
].join('\n');

function spanText(span: { start: number; end: number } | undefined): string | undefined {
  return span ? TEXT.slice(span.start, span.end) : undefined;
}

describe('generateArmSpan', () => {
  it('spans an if arm from the if keyword through its end', () => {
    const span = generateArmSpan(
      TEXT,
      'if',
      { file: 'x.sv', startLine: 17, startColumn: 8, endLine: 17, endColumn: 19 },
      { file: 'x.sv', startLine: 18, startColumn: 11 },
    );
    expect(spanText(span)).toBe(
      'if (ENABLE == 0) begin : g_if_zero\n      leaf u_zero(.a(a), .y(w));\n    end',
    );
  });

  it('spans an else-if arm including a nested case statement', () => {
    const span = generateArmSpan(
      TEXT,
      'else-if',
      { file: 'x.sv', startLine: 19, startColumn: 17, endLine: 19, endColumn: 28 },
      { file: 'x.sv', startLine: 20, startColumn: 6 },
    );
    const text = spanText(span);
    expect(text?.startsWith('else if (ENABLE == 1) begin : g_if_one')).toBe(true);
    expect(text?.includes('endcase')).toBe(true);
    expect(text?.endsWith('endcase\n    end')).toBe(true);
  });

  it('spans an else arm from the else keyword', () => {
    const span = generateArmSpan(
      TEXT,
      'else',
      { file: 'x.sv', startLine: 19, startColumn: 13, endLine: 33, endColumn: 7 },
      { file: 'x.sv', startLine: 32, startColumn: 6 },
    );
    expect(spanText(span)).toBe("else begin : g_if_other\n      assign w = 1'b0;\n    end");
  });

  it('spans a case arm from its value through its end', () => {
    const span = generateArmSpan(
      TEXT,
      'case',
      { file: 'x.sv', startLine: 21, startColumn: 8, endLine: 21, endColumn: 9 },
      { file: 'x.sv', startLine: 22, startColumn: 10 },
    );
    expect(spanText(span)).toBe(
      '0: begin : g_case_0\n          leaf u_case_0(.a(a), .y(w));\n        end',
    );
  });

  it('spans a default arm from the default keyword', () => {
    const span = generateArmSpan(
      TEXT,
      'case-default',
      { file: 'x.sv', startLine: 20, startColumn: 6, endLine: 30, endColumn: 13 },
      { file: 'x.sv', startLine: 28, startColumn: 17 },
    );
    expect(spanText(span)).toBe(
      'default: begin : g_case_default\n          assign w = c;\n        end',
    );
  });

  it('returns undefined when the nearest begin belongs to an earlier block', () => {
    // Anchor after g_if_zero's end but with no begin of its own — the matched end
    // precedes the anchor, so no span is produced.
    const span = generateArmSpan(
      TEXT,
      'else',
      { file: 'x.sv', startLine: 36, startColumn: 2 },
      { file: 'x.sv', startLine: 36, startColumn: 2 },
    );
    expect(span).toBeUndefined();
  });
});
