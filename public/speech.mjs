/**
 * Speech helpers that do not touch the DOM, so the text rules and voice
 * ranking can be tested in Node.
 *
 * ATHENA speaks through the browser's own speech engine. There is no server
 * TTS: the voice list, the audio and the latency all belong to the device.
 */

const ABBREVIATIONS = [
  [/\bATHENA\b/gi, "Athena"],
  [/\bGPU\b/g, "G P U"],
  [/\bCPU\b/g, "C P U"],
  [/\bVRAM\b/g, "V ram"],
  [/\bRAM\b/g, "ram"],
  [/\bAPI\b/g, "A P I"],
  [/\bURL\b/g, "U R L"],
  [/\bLLM\b/g, "L L M"],
  [/\bIP\b/g, "I P"],
  [/\bOS\b/g, "O S"],
  [/\bGB\b/g, "gigabytes"],
  [/\bMB\b/g, "megabytes"],
  [/\bTB\b/g, "terabytes"],
  [/\bFPS\b/g, "frames per second"],
  [/\bPC\b/g, "P C"],
  [/\bID\b/g, "I D"],
];

/** Plain words for things a speech engine reads badly. */
export function normalizeSpeech(text) {
  let out = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_#>|]/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");

  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);

  out = out
    .replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, "$1 dot $2 dot $3 dot $4")
    .replace(/\bv(\d+)\.(\d+)\.(\d+)\b/gi, "version $1 point $2 point $3")
    .replace(/(\d+)\.(\d+)\.(\d+)\b/g, "$1 point $2 point $3")
    .replace(/(\d)\s*%/g, "$1 percent")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s*→\s*/g, " to ")
    .replace(/\s*[·•]\s*/g, ", ")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return out;
}

/**
 * Mouth-sized pieces. Safari goes silent on long blocks, and cutting in the
 * middle of a word is what makes a voice sound drunk.
 */
export function speechChunks(text, max = 180) {
  const clean = normalizeSpeech(text);
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]*/g) || [clean];
  const chunks = [];
  let current = "";

  const push = (piece) => {
    if (piece) chunks.push(piece.trim());
  };

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((current + " " + piece).trim().length <= max) {
      current = (current + " " + piece).trim();
      continue;
    }
    push(current);
    current = "";
    if (piece.length <= max) {
      current = piece;
      continue;
    }
    /* A single huge sentence: split on spaces, never inside a word. */
    let line = "";
    for (const word of piece.split(" ")) {
      if (!word) continue;
      if ((line + " " + word).trim().length > max) {
        push(line);
        line = word;
      } else {
        line = (line + " " + word).trim();
      }
    }
    current = line;
  }
  push(current);
  return chunks.slice(0, 12);
}

const STRONG_NAMES =
  /(natural|neural|premium|enhanced|online|aria|jenny|guy|sonia|libby|natasha|samantha|serena|ava|allie|zoe|emma|brian|andrew|christopher|eric|roger|steffan|ryan)/i;
const WEAK_NAMES = /(compact|espeak|festival|pico|desktop|david|mark|zira|hazel)/i;

/** Higher is better. Quality first, then English, then local availability. */
export function voiceScore(voice = {}) {
  let score = 0;
  if (/^en[-_]/i.test(String(voice.lang || ""))) score += 40;
  if (STRONG_NAMES.test(String(voice.name || ""))) score += 35;
  if (/natural|neural/i.test(String(voice.name || ""))) score += 25;
  if (WEAK_NAMES.test(String(voice.name || ""))) score -= 30;
  if (voice.localService === false) score += 5; /* usually a cloud neural voice */
  if (voice.default) score += 2;
  return score;
}

export function rankVoices(voices = []) {
  return [...voices]
    .filter((voice) => voice && voice.name)
    .sort((a, b) => voiceScore(b) - voiceScore(a) || String(a.name).localeCompare(String(b.name)));
}

export function voiceLabel(voice = {}) {
  const lang = voice.lang ? ` · ${voice.lang}` : "";
  const where = voice.localService === false ? " · CLOUD" : "";
  return `${voice.name || "Unnamed voice"}${lang}${where}`;
}
