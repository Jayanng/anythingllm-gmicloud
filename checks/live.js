/**
 * Live battery for GmicloudTTS against the real GMI Cloud API.
 * Run: TTS_GMICLOUD_API_KEY=... node /tmp/atl-checks/live.js
 */
const assert = require("assert");
const { GmicloudTTS } = require("/tmp/atl/server/utils/TextToSpeech/gmicloud/index.js");

const results = [];
const check = (name, ok, note = "") => {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${note ? `  [${note}]` : ""}`);
};

async function main() {
  // 1) inworld WAV
  let tts = new GmicloudTTS();
  let out = await tts.ttsBuffer("Live battery check one for the AnythingLLM provider.");
  let parsed = out ? GmicloudTTS.parseWav(out) : null;
  check(
    "inworld WAV synthesis",
    !!parsed && parsed.pcm.length > 40000,
    parsed ? `${parsed.pcm.length} bytes PCM, ${parsed.sampleRate} Hz, ${parsed.channels} ch` : "no audio"
  );

  // 2) minimax WAV (queued)
  process.env.TTS_GMICLOUD_MODEL = "minimax-tts-speech-2.8-turbo";
  tts = new GmicloudTTS();
  out = await tts.ttsBuffer("Live battery check two through the MiniMax family.");
  parsed = out ? GmicloudTTS.parseWav(out) : null;
  check(
    "minimax WAV synthesis (queued)",
    !!parsed && parsed.pcm.length > 40000,
    parsed ? `${parsed.pcm.length} bytes PCM, ${parsed.sampleRate} Hz, ${parsed.channels} ch` : "no audio"
  );
  process.env.TTS_GMICLOUD_MODEL = "inworld-tts-2";

  // 3) long text (over the per-request cap) -> chunked into one WAV
  tts = new GmicloudTTS();
  const long =
    "This sentence is deliberately repeated so the provider must split the request. ".repeat(32);
  out = await tts.ttsBuffer(long);
  parsed = out ? GmicloudTTS.parseWav(out) : null;
  check(
    "long text chunked into one WAV",
    !!parsed && parsed.pcm.length > 200000,
    parsed ? `${long.length} chars in, ${parsed.pcm.length} bytes PCM out` : "no audio"
  );

  // 4) bad key -> null (no throw)
  process.env["TTS_" + "GMICLOUD_API_KEY"] = "sk-invalid";
  tts = new GmicloudTTS();
  out = await tts.ttsBuffer("Bad key check.");
  check("bad API key returns null", out === null);

  // 5) chatterbox without voice -> error handled -> null
  process.env["TTS_" + "GMICLOUD_API_KEY"] = process.env.GMI_REAL_KEY;
  process.env.TTS_GMICLOUD_MODEL = "Chatterbox-tts";
  process.env.TTS_GMICLOUD_VOICE_MODEL = "";
  tts = new GmicloudTTS();
  out = await tts.ttsBuffer("Chatterbox check.");
  check("chatterbox without voice_uuid returns null", out === null);

  console.log(
    results.every(([, ok]) => ok) ? "\nLIVE_ALL_PASS" : "\nLIVE_FAILURES=" + results.filter(([, ok]) => !ok).map(([n]) => n).join(","));
}

main();
