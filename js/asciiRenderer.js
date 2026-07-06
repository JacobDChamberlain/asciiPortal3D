// asciiRenderer.js
// Lifted (near-verbatim) from ../asciify — the proven ASCII-conversion engine.
// Core idea: sample any drawable source (image, video frame, OR another canvas)
// into a low-res grid, map each cell's luminance to a character, and paint the
// result onto a visible <canvas>. Here the "source" is the Three.js game canvas,
// so the 3D frame gets re-rendered as ASCII every tick.

export const CHAR_RAMPS = {
  // Ordered dense -> sparse. Index 0 is the "heaviest" glyph.
  standard: '@%#*+=-:. ',
  detailed: '$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,"^`\'. ',
  blocks: '█▓▒░ ',
};

const ASPECT_MEASURE_SIZE = 100; // px, used once to measure the monospace glyph ratio
const FONT_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export class AsciiRenderer {
  /** @param {HTMLCanvasElement} canvas visible output canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Offscreen canvas used to downsample the source into a tiny grid.
    this.sample = document.createElement('canvas');
    this.sampleCtx = this.sample.getContext('2d', { willReadFrequently: true });

    // --- Tunable state ---
    this.columns = 160;        // grid width in characters
    this.ramp = CHAR_RAMPS.standard;
    this.color = false;        // true => tint each glyph with its source color
    this.invert = false;       // flip the brightness->glyph mapping
    this.fg = '#7dffb0';       // ink color in mono mode
    this.bg = '#02040a';
    this.outputWidth = 900;    // target output width in CSS px

    // Measure how wide a monospace glyph is relative to its height so the grid
    // stays proportional and per-row text lands on exact cell boundaries.
    this.ctx.font = `${ASPECT_MEASURE_SIZE}px ${FONT_STACK}`;
    this.fontAspect = this.ctx.measureText('M').width / ASPECT_MEASURE_SIZE;

    this._last = null;
  }

  // ---- Setters ----
  setColumns(n) { this.columns = Math.max(8, Math.round(n)); }
  setRamp(key) { this.ramp = CHAR_RAMPS[key] || CHAR_RAMPS.standard; }
  setColor(on) { this.color = !!on; }
  setInvert(on) { this.invert = !!on; }
  setFg(hex) { this.fg = hex; }
  setOutputWidth(px) { this.outputWidth = Math.max(120, Math.round(px)); }

  /**
   * Render a drawable source (image / video / canvas) as ASCII.
   * @param {CanvasImageSource} source
   * @param {number} srcW natural source width
   * @param {number} srcH natural source height
   */
  render(source, srcW, srcH) {
    if (!srcW || !srcH) return;
    this._last = { source, srcW, srcH };

    const cols = this.columns;
    const aspect = this.fontAspect;
    // Rows chosen so the physical glyph grid matches the source aspect ratio.
    const rows = Math.max(1, Math.round(cols * (srcH / srcW) * aspect));

    // 1. Downsample the source into a cols x rows grid.
    if (this.sample.width !== cols || this.sample.height !== rows) {
      this.sample.width = cols;
      this.sample.height = rows;
    }
    this.sampleCtx.clearRect(0, 0, cols, rows);
    this.sampleCtx.drawImage(source, 0, 0, cols, rows);
    const px = this.sampleCtx.getImageData(0, 0, cols, rows).data;

    // 2. Work out glyph metrics and size the output canvas.
    const charW = this.outputWidth / cols;
    const fontSize = charW / aspect; // glyph height that yields the wanted width
    const charH = fontSize;
    const outW = Math.round(charW * cols);
    const outH = Math.round(charH * rows);

    if (this.canvas.width !== outW || this.canvas.height !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
    }

    const ctx = this.ctx;
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, outW, outH);
    ctx.font = `${fontSize}px ${FONT_STACK}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const ramp = this.ramp;
    const lastIdx = ramp.length - 1;

    if (this.color) {
      this._paintColor(ctx, px, cols, rows, charW, charH, ramp, lastIdx);
    } else {
      this._paintMono(ctx, px, cols, rows, charW, charH, ramp, lastIdx);
    }
  }

  // Fast path: one fillText per row (all glyphs share the ink color).
  _paintMono(ctx, px, cols, rows, charW, charH, ramp, lastIdx) {
    ctx.fillStyle = this.fg;
    for (let y = 0; y < rows; y++) {
      let line = '';
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        line += ramp[this._glyphIndex(px[i], px[i + 1], px[i + 2], lastIdx)];
      }
      ctx.fillText(line, 0, y * charH);
    }
  }

  // Color path: per-glyph fill so each character keeps its source color.
  // (Slower — one fillText per glyph. Fine for stills / low columns.)
  _paintColor(ctx, px, cols, rows, charW, charH, ramp, lastIdx) {
    for (let y = 0; y < rows; y++) {
      const yPos = y * charH;
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        const ch = ramp[this._glyphIndex(r, g, b, lastIdx)];
        if (ch === ' ') continue;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillText(ch, x * charW, yPos);
      }
    }
  }

  // Luminance (Rec. 601) -> ramp index. Bright pixels map to dense glyphs so an
  // image reads correctly on a dark background; invert flips that.
  _glyphIndex(r, g, b, lastIdx) {
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255; // 0..1
    const t = this.invert ? lum : 1 - lum;
    let idx = (t * lastIdx) | 0;
    if (idx < 0) idx = 0; else if (idx > lastIdx) idx = lastIdx;
    return idx;
  }
}
