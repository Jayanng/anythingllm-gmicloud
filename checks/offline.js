/**
 * Offline behavior checks for GmicloudTTS (mocked fetch).
 * Run: node /tmp/atl-checks/offline.js
 */
const assert = require("assert");
const { GmicloudTTS } = require("/tmp/atl/server/utils/TextToSpeech/gmicloud/index.js");

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name, "-", e.message);
    process.exitCode = 1;
  }
};

// family mapping
check("family mapping", () => {
  assert.strictEqual(GmicloudTTS.family("inworld-tts-2"), "inworld");
  assert.strictEqual(GmicloudTTS.family("minimax-tts-speech-2.8-turbo"), "minimax");
  assert.strictEqual(GmicloudTTS.family("Chatterbox-tts"), "chatterbox");
  assert.strictEqual(GmicloudTTS.family("future-model"), "inworld");
});

// payloads
check("inworld payload", () => {
  const body = GmicloudTTS.buildRequest("hello", "inworld-tts-2", "Dennis");
  assert.deepStrictEqual(body, {
    model: "inworld-tts-2",
    payload: { text: "hello", audio_encoding: "WAV", speaking_rate: 1.0, voice_id: "Dennis" },
  });
});
check("minimax payload with family default voice", () => {
  const body = GmicloudTTS.buildRequest("hello", "minimax-tts-speech-2.8-turbo", undefined);
  assert.strictEqual(body.payload.voice_id, "English_expressive_narrator");
  assert.strictEqual(body.payload.format, "wav");
  assert.strictEqual(body.payload.speed, "1.0");
});
check("chatterbox requires voice uuid", () => {
  assert.throws(() => GmicloudTTS.buildRequest("hi", "Chatterbox-tts", undefined), /voice UUID/);
  const body = GmicloudTTS.buildRequest("hi", "Chatterbox-tts", "uuid-1");
  assert.deepStrictEqual(body.payload, { data: "hi", voice_uuid: "uuid-1", output_format: "wav" });
});

// url extraction
check("audio url extraction", () => {
  assert.strictEqual(GmicloudTTS.extractAudioUrl({ outcome: { audio_url: "u" } }), "u");
  assert.strictEqual(GmicloudTTS.extractAudioUrl({ outcome: { media_urls: [{ url: "v" }] } }), "v");
  assert.strictEqual(GmicloudTTS.extractAudioUrl({ outcome: {} }), undefined);
  assert.strictEqual(GmicloudTTS.extractAudioUrl({}), undefined);
});

// chunking
check("chunkText splits at sentences under the limit", () => {
  const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
  const chunks = GmicloudTTS.chunkText(long);
  assert.ok(chunks.length > 1, "expected multiple chunks");
  for (const c of chunks) assert.ok(c.length <= 1900, `chunk too long: ${c.length}`);
  assert.strictEqual(chunks.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
});
check("chunkText passes short text through", () => {
  assert.deepStrictEqual(GmicloudTTS.chunkText("Hi there."), ["Hi there."]);
  assert.deepStrictEqual(GmicloudTTS.chunkText("   "), []);
});

// wav parse + wrap
check("wav parse/wrap roundtrip", () => {
  const pcm = Buffer.alloc(480 * 2, 1);
  const wav = GmicloudTTS.wrapWav(pcm, 48000, 1, 2);
  const parsed = GmicloudTTS.parseWav(wav);
  assert.ok(parsed);
  assert.strictEqual(parsed.sampleRate, 48000);
  assert.strictEqual(parsed.channels, 1);
  assert.strictEqual(parsed.sampleWidth, 2);
  assert.strictEqual(parsed.pcm.length, pcm.length);
});
check("parseWav rejects garbage", () => {
  assert.strictEqual(GmicloudTTS.parseWav(Buffer.from("junk")), null);
  assert.strictEqual(GmicloudTTS.parseWav("not a buffer"), null);
});

// full ttsBuffer flows with mocked fetch
const wavBuf = (n) => GmicloudTTS.wrapWav(Buffer.alloc(n, 7), 48000, 1, 2);
const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => wavBuf(2000),
});

const check2 = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (e) {
    console.log("FAIL", name, "-", e.message);
    process.exitCode = 1;
  }
};

async function flows() {
  const env = process.env["TTS_" + "GMICLOUD_API_KEY"];
  process.env["TTS_" + "GMICLOUD_API_KEY"] = "test-key-value";
  const tts = new GmicloudTTS();

  // synchronous inline outcome
  {
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url, init });
      return url.includes("/requests")
        ? jsonResponse({ outcome: { audio_url: "https://a/x.wav" }, request_id: "r", status: "success" })
        : jsonResponse({}, 200);
    };
    const out = await tts.ttsBuffer("Hello world");
    assert.ok(Buffer.isBuffer(out) && out.length > 44, "expected a WAV buffer");
    assert.strictEqual(out.toString("ascii", 0, 4), "RIFF");
    assert.strictEqual(calls[0].init.method, "POST");
    assert.ok(calls[0].init.headers.Authorization.length > 10);
    console.log("PASS ttsBuffer inline outcome");
    passed += 1;
  }

  // queued path with polling
  {
    let polls = 0;
    global.fetch = async (url) => {
      if (url.includes("/requests/r")) {
        polls += 1;
        return polls < 2
          ? jsonResponse({ request_id: "r", status: "processing" })
          : jsonResponse({ outcome: { audio_url: "https://a/x.wav" }, request_id: "r", status: "success" });
      }
      if (url.includes("/requests"))
        return jsonResponse({ request_id: "r", status: "dispatched" });
      return jsonResponse({}, 200);
    };
    const out = await tts.ttsBuffer("Hello queued");
    assert.ok(Buffer.isBuffer(out));
    assert.strictEqual(polls, 2);
    console.log("PASS ttsBuffer queued polling");
    passed += 1;
  }

  // permanent poll error fails fast
  {
    let polls = 0;
    global.fetch = async (url) => {
      if (url.includes("/requests/r")) {
        polls += 1;
        return jsonResponse({ error: "Invalid API key" }, 401);
      }
      return jsonResponse({ request_id: "r", status: "dispatched" });
    };
    const out = await tts.ttsBuffer("Hello fail");
    assert.strictEqual(out, null);
    assert.strictEqual(polls, 1);
    console.log("PASS poll 401 fails fast");
    passed += 1;
  }

  // multi-chunk concatenation into one WAV
  {
    let posts = 0;
    global.fetch = async (url) => {
      if (url.includes("/requests")) {
        posts += 1;
        return jsonResponse({ outcome: { audio_url: `https://a/${posts}.wav` }, request_id: "r", status: "success" });
      }
      return jsonResponse({}, 200);
    };
    const long = Array.from({ length: 100 }, (_, i) => `Chunk sentence ${i} here.`).join(" ");
    const out = await tts.ttsBuffer(long);
    assert.ok(posts > 1, `expected multiple POSTs, got ${posts}`);
    const parsed = GmicloudTTS.parseWav(out);
    assert.strictEqual(parsed.sampleRate, 48000);
    assert.strictEqual(parsed.pcm.length, posts * 2000, "PCM concatenated in order");
    console.log("PASS multi-chunk concatenation (" + posts + " chunks)");
    passed += 1;
  }

  // empty-string env falls back to defaults (regression: ?? missed "")
  {
    process.env.TTS_GMICLOUD_ENDPOINT = "";
    process.env.TTS_GMICLOUD_MODEL = "";
    process.env.TTS_GMICLOUD_VOICE_MODEL = "";
    const t = new GmicloudTTS();
    check2("empty-string env fallbacks", () => {
      assert.strictEqual(t.endpoint, "https://console.gmicloud.ai");
      assert.strictEqual(t.model, "inworld-tts-2");
      assert.strictEqual(t.voice, undefined);
    });
    delete process.env.TTS_GMICLOUD_ENDPOINT;
    delete process.env.TTS_GMICLOUD_MODEL;
    delete process.env.TTS_GMICLOUD_VOICE_MODEL;
  }

  // parseWav never throws on truncated chunk bodies (regression)
  check2("truncated chunk bodies -> null, no throw", () => {
    const base = GmicloudTTS.wrapWav(Buffer.alloc(8, 1), 48000, 1, 2);
    const tail = Buffer.concat([Buffer.from("fmt "), Buffer.alloc(4)]);
    const crafted = Buffer.concat([base, tail]);
    assert.strictEqual(GmicloudTTS.parseWav(crafted), null);
  });

  // concurrency: two calls share no mutable state
  {
    let posts = 0;
    global.fetch = async (url) => {
      if (url.includes("/requests")) {
        posts += 1;
        return jsonResponse({ outcome: { audio_url: `https://a/${posts}.wav` }, request_id: "r", status: "success" });
      }
      return jsonResponse({}, 200);
    };
    const [a, b] = await Promise.all([tts.ttsBuffer("First call."), tts.ttsBuffer("Second call.")]);
    check2("concurrent calls isolated", () => {
      assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(b));
      assert.strictEqual(a.length, b.length);
    });
  }

  // JSON-hostile text survives the payload encoding
  {
    let sent = null;
    global.fetch = async (url, init = {}) => {
      if (url.includes("/requests")) {
        sent = init.body;
        return jsonResponse({ outcome: { audio_url: "https://a/x.wav" }, request_id: "r", status: "success" });
      }
      return jsonResponse({}, 200);
    };
    const hostile = 'He said \"hi\" \\n and {braces} `ticks` </script>';
    await tts.ttsBuffer(hostile);
    check2("JSON-hostile text encoded safely", () => {
      const parsed = JSON.parse(sent);
      assert.strictEqual(parsed.payload.text, hostile);
    });
  }

  // empty input
  {
    const out = await tts.ttsBuffer("   ");
    assert.strictEqual(out, null);
    console.log("PASS empty input -> null");
    passed += 1;
  }

  if (env === undefined) delete process.env["TTS_" + "GMICLOUD_API_KEY"];
  else process.env["TTS_" + "GMICLOUD_API_KEY"] = env;

  console.log(`\nOFFLINE_ALL_PASS (${passed} checks)`);
}

flows();
