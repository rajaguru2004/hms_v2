# Reference voices for IndicF5 — the contract

These eleven directories are empty on purpose. Drop a reference pair into one
and that language lights up: no code change, no restart, no edit to
`config.yaml`. Availability is read off this directory at request time.

```
tts/voices/<code>/reference.wav     a few seconds of one person speaking that language
tts/voices/<code>/reference.txt     exactly what they say, in that language's script
```

`<code>` is the ISO code in `language_config.py`:

| Code | Language  | Script     | Code | Language | Script     |
| ---- | --------- | ---------- | ---- | -------- | ---------- |
| `as` | Assamese  | Bengali    | `mr` | Marathi  | Devanagari |
| `bn` | Bengali   | Bengali    | `or` | Odia     | Odia       |
| `gu` | Gujarati  | Gujarati   | `pa` | Punjabi  | Gurmukhi   |
| `hi` | Hindi     | Devanagari | `ta` | Tamil    | Tamil      |
| `kn` | Kannada   | Kannada    | `te` | Telugu   | Telugu     |
| `ml` | Malayalam | Malayalam  |      |          |            |

English is not here and cannot be: IndicF5 was not trained on it. English is
spoken by Piper, from `ai-sidecar/voices/en_US-lessac-medium.onnx`.

## reference.wav

| Property    | Required                                                         | Why                                                                                                                        |
| ----------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Container   | RIFF/WAVE, uncompressed                                          | Read with Python's `wave`. An MP3 renamed `.wav` is refused at load.                                                       |
| Bit depth   | 16-bit PCM                                                       | What the model's own loader expects; 24- and 32-bit are refused.                                                           |
| Channels    | 1 (mono)                                                         | Stereo loads but only one channel is used — record mono.                                                                   |
| Sample rate | 24000 Hz                                                         | IndicF5 generates at 24 kHz. Anything else is resampled; ≥16 kHz is usable, below that is warned about and sounds like it. |
| Duration    | **3–10 seconds**                                                 | Under 2 s the voice is not established. Over 20 s every synthesis pays for it, and the model does not use the extra.       |
| Content     | One speaker, no music, no second voice, no phone-codec artefacts | The output copies what it is given, artefacts included.                                                                    |
| Delivery    | Ordinary pace, ordinary tone                                     | Prosody is copied too: a dramatic reading makes every clinical question dramatic.                                          |

Outside 2–20 s, or below 16 kHz, or in stereo, the language still works and the
load log says what is wrong with it. Unreadable, not 16-bit, or zero bytes and
the language is **unavailable** — see "Half a pair" below.

## reference.txt

**UTF-8, no BOM.** This is not a style rule. A UTF-8 BOM is three bytes that
decode to `U+FEFF`, and they land on the front of the first word of the
transcript — the model then conditions on a first token that is not the word
anybody wrote. That exact failure bit this project today, in a different file.
This loader strips a BOM if it finds one and logs a warning naming the file, so
it cannot corrupt anything silently, but save it without one:

- VS Code: "UTF-8" in the status bar, never "UTF-8 with BOM".
- PowerShell: `Set-Content -Encoding utf8NoBOM` (PowerShell 7) — Windows
  PowerShell 5.1's `utf8` **writes a BOM**; use `[System.IO.File]::WriteAllText`
  there, or just save from an editor.
- Notepad: Save As → Encoding → UTF-8 (not "UTF-8 with BOM").

**It must match the audio exactly** — every word actually spoken, in the
language's own script, with the punctuation that is actually there. Not a
translation, not a transliteration into Latin letters, not a tidied-up version.

A mismatch does not fail. That is what makes it dangerous: the model conditions
on both the audio and the text, and a transcript that disagrees with the
recording produces audio that is fluent, confident and wrong — mispronounced
words, dropped syllables, occasionally a drift into the wrong language
entirely. The service cannot detect this and neither can a patient who does not
already know what they were about to be asked. One careful proofread of eleven
short lines is the whole mitigation.

One line is ideal. Leading and trailing whitespace is stripped; internal line
breaks are kept as written.

## Half a pair is no pair

A language is available only when **both** files are present and valid:
`reference.wav` readable as 16-bit PCM, `reference.txt` non-empty after the BOM
and whitespace are stripped. Anything else and the language reports unavailable
in `/health` and `POST /tts` answers 503 with a written sentence.

Every problem is logged **when the provider loads**, one line per language,
naming the file and the reason — a half-supplied language is meant to be
obvious at startup rather than at the first patient request.

It is never, under any circumstance, synthesised from another language's
reference. That would produce a real human voice speaking fluently in the wrong
language at HTTP 200, which is strictly worse than the bug this package was
written to fix (a Tamil question read aloud by an English voice): a patient can
hear that an English voice is not Tamil. They cannot hear that fluent Bengali
was supposed to be Odia.

## Nothing clinical, nobody identifiable

These files are committed to the repository. A neutral sentence — a greeting, a
line about the weather, a sentence from a public-domain text — is the whole
requirement. A patient's recorded voice is the single most identifying thing
this system handles, which is why `audio_source.dart` refuses to write
recordings to disk at all; the same rule applies here with more force, because
git remembers.

Sources that fit: AI4Bharat's IndicTTS and Rasa releases (CC-BY 4.0), Mozilla
Common Voice (CC0), or a colleague reading one sentence into a phone and saying
it may be committed.

## Checking your work

```sh
.venv/Scripts/python.exe -c "import tts, json; print(json.dumps(tts.availability(), indent=1, ensure_ascii=False))"
```

Each language reports which provider would speak it and why not, if not. The
same information is in `GET /health` under `languages` and `ttsProviders`.
