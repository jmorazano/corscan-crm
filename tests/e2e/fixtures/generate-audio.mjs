// Genera tests/e2e/fixtures/nota-de-voz.wav (015): 1 s de seno a 440 Hz,
// PCM16 mono 16 kHz, -12 dBFS. Sin dependencias: `node tests/e2e/fixtures/generate-audio.mjs`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rate = 16000;
const seconds = 1;
const samples = rate * seconds;
const dataBytes = samples * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(rate, 24);
buf.writeUInt32LE(rate * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(dataBytes, 40);
const amp = Math.round(0x7fff * Math.pow(10, -12 / 20));
for (let i = 0; i < samples; i++) {
  buf.writeInt16LE(Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "nota-de-voz.wav");
writeFileSync(out, buf);
console.log(`escrito ${out} (${buf.length} bytes)`);
