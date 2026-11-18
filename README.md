# anythingllm-gmicloud

GMI Cloud text-to-speech provider for [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm).

One provider covers the speech model families GMI Cloud serves behind one
multimodal request queue:

- **Inworld Realtime TTS** (`inworld-tts-*`) — low-latency speech well suited
  to conversational voice
- **MiniMax speech synthesis** (`minimax-tts-speech-*`)
- **Resemble AI Chatterbox** (`Chatterbox-tts`, requires a Resemble
  `voice_uuid` as the voice)

AnythingLLM providers are in-tree modules, so this integration ships as a
patch. Upstream pull request:
https://github.com/Mintplex-Labs/anything-llm/pull/6987

## Install (self-hosted AnythingLLM)

Apply the patch to your checkout:

```bash
git apply gmicloud-tts.patch
```

Or copy `server/utils/TextToSpeech/gmicloud/` into your checkout and apply the
small wiring changes shown in the patch (registry case, settings mapping,
settings UI, chat TTS button).

## Configure

```bash
TTS_PROVIDER="gmicloud"
TTS_GMICLOUD_API_KEY="your-gmi-cloud-api-key"
TTS_GMICLOUD_MODEL="inworld-tts-2"
TTS_GMICLOUD_VOICE_MODEL= # optional, family default used when empty
TTS_GMICLOUD_ENDPOINT="https://console.gmicloud.ai"
```

Or use **Settings → Audio → Text-to-speech** and pick **GMI Cloud**.

## Behavior

- Requests go through GMI Cloud's request queue: synchronous inline outcomes
  resolve immediately, queued generations are polled (permanent HTTP errors
  fail fast, 408/429/5xx retry).
- GMI caps text per request (2,000 characters on Inworld). Long replies are
  split at sentence boundaries and the per-chunk PCM is concatenated into a
  single WAV file, with format consistency enforced across chunks.
- Audio is WAV throughout; AnythingLLM detects the container from the buffer.
- Chatterbox models need a Resemble voice UUID in the Voice Model field and
  raise a clear error without one.
- MiniMax generations go through the queue and are usually quick; an
  occasional request runs long. Inworld is the low-latency option.

## Verification

`checks/` holds the verification batteries that were run against this code
(mocked-HTTP behavior checks and live runs against the GMI Cloud API):

```bash
node checks/offline.js
TTS_GMICLOUD_API_KEY=... node checks/live.js
TTS_GMICLOUD_API_KEY=... node checks/registry-live.js
```

31 checks were green at release: 18 offline behavior checks, 5 live checks,
and 8 registry and edge checks (dispatch through `getTTSProvider()`, error
contracts, WAV edge cases, live synthesis through the registry path).

## License

Apache-2.0
