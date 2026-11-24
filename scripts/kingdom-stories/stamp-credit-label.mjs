// Stamp the "P2P Global | Creative Studios" credit tag (Creation style: rounded tag, white serif text,
// bottom-right) on every cover. The tag colour is taken from the image area behind it (owner 2026-11-24:
// "the background you use matches the background of the image"): same hue, darkened for legibility.
//   node scripts/kingdom-stories/stamp-credit-label.mjs <in-dir> <out-dir>   (needs ffmpeg; Georgia font from Windows)
import { execFileSync } from "node:child_process";
import { readdirSync, mkdirSync } from "node:fs";
const [inDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const FONT = "C\\:/Windows/Fonts/georgia.ttf";
const TEXT = "P2P Global | Creative Studios";

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToHex(h, s, l) {
  const f = (n) => { const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}

for (const f of readdirSync(inDir).filter((x) => /\.jpe?g$/i.test(x)).sort()) {
  const src = `${inDir}/${f}`;
  const [W, H] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", src]).toString().trim().split(",").map(Number);
  const k = W / 1024;                               // sizes designed for 1024 px
  const fs = Math.round(22 * k), bh = Math.round(46 * k), bw = Math.round(322 * k), r = Math.round(11 * k), m = Math.round(18 * k);
  const x = W - bw - m, y = H - bh - m;
  // average colour of the area behind the tag (a little larger than the tag)
  const px = execFileSync("ffmpeg", ["-loglevel", "error", "-i", src, "-vf", `crop=${bw + 2 * m}:${bh + 2 * m}:${x - m}:${y - m},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const [h, s0, l0] = rgbToHsl(px[0], px[1], px[2]);
  const hex = hslToHex(h, Math.min(s0, 0.38), Math.min(Math.max(l0 * 0.45, 0.12), 0.2));   // same hue, deep shade
  const label = `color=c=0x${hex}:s=${bw}x${bh},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(gt(abs(X-${bw}/2+0.5),${bw}/2-${r})*gt(abs(Y-${bh}/2+0.5),${bh}/2-${r}),if(lte(hypot(abs(X-${bw}/2+0.5)-(${bw}/2-${r}),abs(Y-${bh}/2+0.5)-(${bh}/2-${r})),${r}),214,0),214)',drawtext=fontfile='${FONT}':text='${TEXT}':fontsize=${fs}:fontcolor=0xF6F3EC:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(k)}`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-f", "lavfi", "-i", label, "-filter_complex", `[0][1]overlay=${x}:${y}:shortest=1`, "-frames:v", "1", "-q:v", "2", `${outDir}/${f}`]);
  console.log(f, "#" + hex);
}
