import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpeech, rankVoices, speechChunks, voiceLabel } from "../public/speech.mjs";

test("abbreviations and punctuation are spoken as words", () => {
  const line = normalizeSpeech("ATHENA sees GPU load at 55% · API on 192.168.1.7 → v3.0.0");
  assert.match(line, /^Athena sees G P U load at 55 percent/);
  assert.match(line, /A P I/);
  assert.match(line, /192 dot 168 dot 1 dot 7/);
  assert.match(line, /version 3 point 0 point 0/);
  assert.doesNotMatch(line, /[·→]/);
});

test("markdown and code fences never reach the voice", () => {
  assert.equal(normalizeSpeech("**Done.** `ls`"), "Done. ls");
  assert.match(normalizeSpeech("before ```x=1``` after"), /before code block after/);
});

test("long text is split on word boundaries, not through words", () => {
  const original = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ".repeat(6);
  const chunks = speechChunks(original);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 180, `chunk too long: ${chunk.length}`);
    for (const word of chunk.split(" ")) {
      assert.ok(original.includes(word), `chunk cut a word: "${word}"`);
    }
  }
});

test("natural and enhanced voices rank ahead of legacy desktop voices", () => {
  const ranked = rankVoices([
    { name: "Microsoft David Desktop", lang: "en-US", localService: true, default: true },
    { name: "Microsoft Zira Desktop", lang: "en-US", localService: true },
    { name: "Microsoft Aria Online (Natural)", lang: "en-US", localService: false },
    { name: "Google Deutsch", lang: "de-DE", localService: true },
  ]);
  assert.equal(ranked[0].name, "Microsoft Aria Online (Natural)");
  assert.match(voiceLabel(ranked[0]), /CLOUD/);
  assert.equal(ranked.at(-1).name, "Google Deutsch", "non-English is offered but ranked last");
});
