# Where each reference pair came from

Provenance and licence for every `reference.wav` / `reference.txt` in this
directory. Both sources are openly licensed and both require attribution, so
this file is a licence obligation rather than a courtesy.

Every clip is one human speaker, recorded by the source project, converted here
to the contract in `README.md` (16-bit PCM mono 24 kHz) and nothing else — no
trimming, no denoising, no synthesis. Each `reference.txt` is the source
corpus's own transcript of that exact clip, unedited, UTF-8 with no BOM.

## AI4Bharat IndicF5 prompts

The prompt clips published with the model itself, from
<https://github.com/AI4Bharat/IndicF5/tree/main/prompts>. Transcripts are the
`ref_text` values AI4Bharat publish alongside them in the demo Space,
<https://huggingface.co/spaces/ai4bharat/IndicF5/blob/main/app.py>. These are
the model's own reference distribution, so prefer them where they exist.

| Lang         | File                    | Source                                                                                   |
| ------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `kn` Kannada | `KAN_F_HAPPY_00001.wav` | <https://github.com/AI4Bharat/IndicF5/raw/refs/heads/main/prompts/KAN_F_HAPPY_00001.wav> |
| `mr` Marathi | `MAR_F_WIKI_00001.wav`  | <https://github.com/AI4Bharat/IndicF5/raw/refs/heads/main/prompts/MAR_F_WIKI_00001.wav>  |
| `pa` Punjabi | `PAN_F_HAPPY_00002.wav` | <https://github.com/AI4Bharat/IndicF5/raw/refs/heads/main/prompts/PAN_F_HAPPY_00002.wav> |
| `ta` Tamil   | `TAM_F_HAPPY_00001.wav` | <https://github.com/AI4Bharat/IndicF5/raw/refs/heads/main/prompts/TAM_F_HAPPY_00001.wav> |

## FLEURS

AI4Bharat publish no prompt clip for the other seven. These come from Google's
FLEURS corpus, <https://huggingface.co/datasets/google/fleurs>, **CC-BY-4.0** —
read speech, one speaker per clip, with the corpus's own `raw_transcription`.
Attribution: _FLEURS: Few-shot Learning Evaluation of Universal Representations
of Speech_, Conneau et al., Google, CC-BY-4.0.

Below, `…` stands for
`https://huggingface.co/datasets/google/fleurs/resolve/main`.

| Lang           | Config / split             | Source                                                                                                 |
| -------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `as` Assamese  | `as_in` / dev              | <…/data/as_in/audio/dev.tar.gz (member dev/10069197733036396233.wav); transcript …/data/as_in/dev.tsv> |
| `bn` Bengali   | `bn_in` / dev              | <…/data/bn_in/audio/dev.tar.gz (member dev/10040842285215808423.wav); transcript …/data/bn_in/dev.tsv> |
| `gu` Gujarati  | `gu_in` / validation row 1 | <https://huggingface.co/datasets/google/fleurs> (config `gu_in`, validation split, row 1)              |
| `hi` Hindi     | `hi_in` / validation row 6 | <https://huggingface.co/datasets/google/fleurs> (config `hi_in`, validation split, row 6)              |
| `ml` Malayalam | `ml_in` / dev              | <…/data/ml_in/audio/dev.tar.gz (member dev/10961947720327302518.wav)>                                  |
| `or` Odia      | `or_in` / validation row 4 | <https://huggingface.co/datasets/google/fleurs> (config `or_in`, validation split, row 4)              |
| `te` Telugu    | `te_in` / validation row 3 | <https://huggingface.co/datasets/google/fleurs> (config `te_in`, validation split, row 3)              |

## What is not here

Nothing. All eleven languages have a pair. Two AI4Bharat sources that would
have been a better fit are **gated** on Hugging Face and need an account and an
accepted licence before anything can be downloaded, which is why FLEURS was
used instead: `ai4bharat/Rasa` and `ai4bharat/indicvoices_r`.

## Replacing one

These are stand-ins in the sense that any clip meeting `README.md` works, and a
native speaker your clinic knows will sound better than a corpus volunteer —
IndicF5 clones whoever is in this file, so the reference speaker _is_ the voice
every patient in that language hears. Drop a new pair in and it takes effect on
the next request: no restart, no code change. Note the one clip outside the
preferred 3–10 s band, which loads with a warning rather than a refusal:

- `kn` is 11.6 s — inside the loader's tolerated 2–20 s band, so it works, but
  the startup log will say so every time.
