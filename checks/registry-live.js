/**
 * Audit round: live run through the REAL registry + hard edge cases.
 * Run: TTS_GMICLOUD_API_KEY=... node /tmp/atl-checks/registry-live.js
 */
const assert = require("assert");

const results = [];
const check = (name, ok, note = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${note ? `  [${note}]` : ""}`);
};

async function main() {
  // 1) registry dispatch: TTS_PROVIDER=gmicloud resolves to GmicloudTTS
  process.env.TTS_PROVIDER = "gmicloud";
  const { getTTSProvider } = require("/tmp/atl/server/utils/TextToSpeech/index.js");
  const { GmicloudTTS } = require("/tmp/atl/server/utils/TextToSpeech/gmicloud/index.js");
  const provider = getTTSProvider();
  check("registry dispatch via TTS_PROVIDER", provider instanceof GmicloudTTS);

  // 2) missing key: registry throws the clear error
  const saved = process.env["TTS_" + "GMICLOUD_API_KEY"];
  delete process.env["TTS_" + "GMICLOUD_API_KEY"];
  let threw = "";
  try {
    getTTSProvider();
  } catch (e) {
    threw = e.message;
  }
  check("missing key throws clear error", threw.includes("No GMI Cloud API key"), threw.slice(0, 50));
  process.env["TTS_" + "GMICLOUD_API_KEY"] = saved;

  // 3) unknown provider value still errors like their contract
  process.env.TTS_PROVIDER = "nope";
  threw = "";
  try {
    getTTSProvider();
  } catch (e) {
    threw = e.message;
  }
  check("unknown provider rejected", threw.includes("No TTS_PROVIDER"));
  process.env.TTS_PROVIDER = "gmicloud";

  // 4) CJK text without spaces still splits safely (hard cut fallback)
  const cjk = "中".repeat(4200);
  const { GmicloudTTS: G } = require("/tmp/atl/server/utils/TextToSpeech/gmicloud/index.js");
  const chunks = G.chunkText(cjk);
  check(
    "CJK hard-split under limit",
    chunks.length === 3 && chunks.every((c) => c.length <= 1900) && chunks.join("") === cjk,
    `${chunks.length} chunks`
  );

  // 5) odd-sized PCM survives the WAV roundtrip (RIFF pad byte)
  const oddPcm = Buffer.alloc(481, 3); // odd byte length
  const wav = G.wrapWav(oddPcm, 48000, 1, 2);
  const parsed = G.parseWav(wav);
  check(
    "odd-sized PCM roundtrip",
    parsed && parsed.pcm.length === 481 && parsed.sampleWidth === 2,
    parsed ? `${parsed.pcm.length} bytes` : "parse failed"
  );

  // 6) data-before-fmt unusual ordering tolerated
  {
    const normal = G.wrapWav(Buffer.alloc(200, 1), 48000, 1, 2);
    const fmt = normal.subarray(12, 36); // fmt chunk
    const data = normal.subarray(36); // data chunk
    const swapped = Buffer.concat([
      Buffer.from("RIFF"),
      normal.subarray(4, 8),
      Buffer.from("WAVE"),
      data,
      fmt,
    ]);
    const p = G.parseWav(swapped);
    check("data-before-fmt tolerated", p && p.pcm.length === 200 && p.sampleRate === 48000);
  }

  // 7) LIVE through the registry: real synthesis via getTTSProvider()
  const out = await provider.ttsBuffer("Registry path live check for AnythingLLM.");
  const liveParsed = out ? G.parseWav(out) : null;
  check(
    "live synthesis through the registry",
    !!liveParsed && liveParsed.pcm.length > 40000,
    liveParsed ? `${liveParsed.pcm.length} bytes PCM, ${liveParsed.sampleRate} Hz` : "no audio"
  );

  // 8) LIVE chunk-consistency across a long request (stereo minimax concat)
  process.env.TTS_GMICLOUD_MODEL = "minimax-tts-speech-2.8-turbo";
  const tts2 = getTTSProvider();
  const long = "A repeated sentence for the chunk merge audit. ".repeat(60);
  const out2 = await tts2.ttsBuffer(long);
  const p2 = out2 ? G.parseWav(out2) : null;
  check(
    "live multi-chunk merge (minimax)",
    !!p2 && p2.pcm.length > 200000,
    p2 ? `${p2.pcm.length} bytes PCM, ${p2.sampleRate} Hz, ${p2.channels} ch` : "no audio"
  );

  console.log(
    results.every(([, ok]) => ok) ? "\nREGISTRY_LIVE_ALL_PASS" : "\nFAILURES=" + results.filter(([, ok]) => !ok).map(([n]) => n).join(","));
}

main();
