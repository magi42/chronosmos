let context;
const widths = new Map();
export function textWidth(text, size) {
  const key = size + ":" + text;
  if (widths.has(key)) return widths.get(key);
  if (context === undefined) {
    context = null;
    if (typeof CanvasRenderingContext2D !== "undefined") {
      context = document.createElement("canvas").getContext("2d");
    }
  }
  let width;
  if (context) {
    context.font = `${size}px Arial, sans-serif`;
    width = context.measureText(text).width;
  } else
    width =
      [...text].reduce(
        (sum, c) =>
          sum +
          (/\s/.test(c)
            ? 0.278
            : /[ilIjtf.,:;!'|]/.test(c)
              ? 0.25
              : /[mwMW@]/.test(c)
                ? 0.85
                : /[A-Z]/.test(c)
                  ? 0.67
                  : 0.5),
        0,
      ) * size;
  if (widths.size > 10000) widths.clear();
  widths.set(key, width);
  return width;
}
export function wrappedLines(text, width, size, measure = textWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? line + " " + word : word;
      if (line && measure(candidate, size) > width) {
        lines.push(line);
        line = "";
      }
      if (measure(word, size) <= width) line = line ? line + " " + word : word;
      else {
        for (const char of word) {
          if (line && measure(line + char, size) > width) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
    }
    lines.push(line);
  }
  return lines;
}
