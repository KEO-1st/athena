import test from "node:test";
import assert from "node:assert/strict";
import { audioDeviceBelongsToSource, classifyAudioDevices, pickAudioDevice } from "../lib/audio-sources.mjs";

test("microphone and desktop devices are distinct", () => {
  const inventory = classifyAudioDevices([
    "Microphone (Realtek(R) Audio)",
    "Stereo Mix (Realtek(R) Audio)",
    "Headset Microphone (USB)",
    "CABLE Output (VB-Audio Virtual Cable)",
  ]);
  assert.deepEqual(inventory.microphone, ["Microphone (Realtek(R) Audio)", "Headset Microphone (USB)"]);
  assert.deepEqual(inventory.desktop, ["Stereo Mix (Realtek(R) Audio)", "CABLE Output (VB-Audio Virtual Cable)"]);
  assert.equal(inventory.systemAudio, true);
});

test("a microphone is never substituted for missing desktop audio", () => {
  const inventory = classifyAudioDevices(["Microphone (Realtek(R) Audio)"]);
  assert.equal(pickAudioDevice(inventory, "microphone"), "Microphone (Realtek(R) Audio)");
  assert.equal(pickAudioDevice(inventory, "desktop"), null);
  assert.equal(inventory.systemAudio, false);
});

test("a loopback device is not mislabelled as a microphone", () => {
  const inventory = classifyAudioDevices(["Stereo Mix (Realtek(R) Audio)"]);
  assert.deepEqual(inventory.microphone, []);
  assert.equal(pickAudioDevice(inventory, "microphone"), null);
  assert.equal(pickAudioDevice(inventory, "desktop"), "Stereo Mix (Realtek(R) Audio)");
});

test("an explicitly requested device cannot cross audio sources", () => {
  const inventory = classifyAudioDevices([
    "Microphone (Realtek(R) Audio)",
    "Stereo Mix (Realtek(R) Audio)",
  ]);
  assert.equal(audioDeviceBelongsToSource(inventory, "desktop", "Stereo Mix (Realtek(R) Audio)"), true);
  assert.equal(audioDeviceBelongsToSource(inventory, "desktop", "Microphone (Realtek(R) Audio)"), false);
  assert.equal(audioDeviceBelongsToSource(inventory, "microphone", "Microphone (Realtek(R) Audio)"), true);
  assert.equal(audioDeviceBelongsToSource(inventory, "microphone", "Stereo Mix (Realtek(R) Audio)"), false);
  assert.equal(audioDeviceBelongsToSource(inventory, "desktop", "unknown device"), false);
});
