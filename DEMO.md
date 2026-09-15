# MediHive — running the demo

One compose file, one tunnel, one port. Follow this top to bottom.

Everything the phone touches goes through **port 3000**. Nothing else is
reachable from the phone, by design.

---

## 0. Before you start (two minutes, do this the night before)

**Free port 3000.** The containerised API binds it. If you have been running the
API from source, stop it — `Ctrl+C` in the terminal running `npm run start:dev`.
Check it is clear:

```sh
ss -ltn | grep ':3000' && echo "STILL IN USE — stop npm run start:dev" || echo "3000 free"
```

**Make Ollama reachable from containers.** The host Ollama listens on
`127.0.0.1` by default, and a container cannot reach that. Restart it bound to
all interfaces:

```sh
pkill ollama
OLLAMA_HOST=0.0.0.0:11434 nohup ~/.local/ollama/bin/ollama serve > /tmp/ollama.log 2>&1 &
sleep 5 && curl -s http://127.0.0.1:11434/api/tags | head -c 120
```

You should see `gemma3:4b`. Nothing is downloaded — it is already in
`~/.ollama`.

> **Why the host and not a container?** Measured on this box: on the host,
> gemma3:4b costs ~2.9 GB of RAM because 1.9 GB offloads to the GPU. In a
> container with no GPU passthrough it costs the full 3.8 GB. Also,
> `docker pull ollama/ollama` did not finish in ten minutes on this connection.
> Host Ollama is faster, lighter, and has nothing left to download.

---

## 1. Start the stack

```sh
cd ~/StudioProjects/CRM/HMS/hms_v2
docker compose -f docker-compose.demo.yml up -d --build
```

First run takes a few minutes (image build, migrations, seeds). Later runs are
under a minute.

Watch it come up:

```sh
docker compose -f docker-compose.demo.yml ps
```

You want this:

| Container              | Expected       |
| ---------------------- | -------------- |
| `hms_v2_postgres_demo` | `Up (healthy)` |
| `hms_v2_redis_demo`    | `Up (healthy)` |
| `hms_v2_minio_demo`    | `Up (healthy)` |
| `hms_v2_sidecar_demo`  | `Up (healthy)` |
| `hms_v2_api_demo`      | `Up (healthy)` |
| `hms_v2_migrate_demo`  | `Exited (0)`   |
| `hms_v2_seed_demo`     | `Exited (0)`   |

**`Exited (0)` on the last two is correct, not a failure.** They apply the
migrations and load the demo data, then finish. Both are safe to run again —
`up` re-runs them on every start and they skip work already done.

---

## 2. Check it is actually working

Three commands. All three must pass before you open the tunnel.

```sh
# API alive and talking to Postgres
curl -s http://localhost:3000/api/health | head -c 120

# Sign in as the demo patient
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"patient@hms.local","password":"Demo@HMS2024!"}' | head -c 80

# Speech, voice, OCR and the model
docker exec hms_v2_api_demo wget -qO- http://sidecar:8801/health
```

The last one must read exactly:

```json
{
  "ollama": true,
  "ollamaModels": ["gemma3:4b"],
  "stt": true,
  "tts": true,
  "ocr": true
}
```

If `"ollama":false`, go back to step 0 — the host Ollama is on loopback.

---

## 3. Open the tunnel

```sh
ngrok start frontend
```

That uses the reserved static domain already in `~/.config/ngrok/ngrok.yml`.
Equivalent long form:

```sh
ngrok http 3000 --domain=unguessable-sunshine-transpolar.ngrok-free.dev
```

Public URL — **static, so the app is built once and keeps working across
restarts**:

```
https://unguessable-sunshine-transpolar.ngrok-free.dev
```

Confirm from outside:

```sh
curl -s https://unguessable-sunshine-transpolar.ngrok-free.dev/api/health | head -c 120
```

> **One tunnel only.** On the free plan a second tunnel pools onto the same
> static domain and load-balances between them, sending half your requests to
> the wrong port. Do not start a second one.

---

## 4. Build the Flutter app

```sh
flutter build apk --release \
  --dart-define=MEDIHIVE_API=https://unguessable-sunshine-transpolar.ngrok-free.dev/api
```

Or to run it attached to a plugged-in phone:

```sh
flutter run --release \
  --dart-define=MEDIHIVE_API=https://unguessable-sunshine-transpolar.ngrok-free.dev/api
```

`MEDIHIVE_FILES` is **not** needed. Document originals are served by the API on
the same origin, so the one `MEDIHIVE_API` value covers everything the phone
does. (See "Documents through the tunnel" below.)

---

## 5. Demo accounts

They do **not** share a password. Check before you type.

| Email                    | Password          | Role           |
| ------------------------ | ----------------- | -------------- |
| `admin@hms.local`        | `Admin@HMS2024!`  | Admin          |
| `doctor@hms.local`       | `Doctor@HMS2024!` | Doctor         |
| `nurse@hms.local`        | `Nurse@HMS2024!`  | Nurse          |
| `patient@hms.local`      | `Demo@HMS2024!`   | Patient portal |
| `receptionist@hms.local` | `Demo@HMS2024!`   | Reception      |
| `pharmacist@hms.local`   | `Demo@HMS2024!`   | Pharmacy       |
| `lab-tech@hms.local`     | `Demo@HMS2024!`   | Laboratory     |
| `radiologist@hms.local`  | `Demo@HMS2024!`   | Radiology      |
| `billing@hms.local`      | `Demo@HMS2024!`   | Billing        |
| `admin-staff@hms.local`  | `Demo@HMS2024!`   | Admin staff    |

### The five case-taking patients (all `Demo@HMS2024!`)

Pick the one that matches the story you are telling.

| Email                          | Shows                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| `meera.krishnan@hms.local`     | Interview in progress — lands mid-conversation             |
| `rajesh.pillai@hms.local`      | Red flag raised — the ACS screen fired                     |
| `ramesh.kumar@hms.local`       | Uploaded documents — OCR, extraction, a patient correction |
| `lakshmi.venkatesan@hms.local` | Case submitted — the doctor handoff                        |
| `arjun.menon@hms.local`        | Never started — the clean first-run path                   |

`patient@hms.local` is MRN `MRN-PORTAL-0001`, DOB `1990-05-17`.

---

## 6. Things worth knowing on stage

**Consent comes first.** A new case-taking session will not accept an answer
until consent is recorded. If a turn returns
`CASE_SESSION_CONSENT_REQUIRED`, tap through the consent screen. That is the
product working, not a bug.

**Photograph documents generously.** The pipeline rejects images whose short
edge is under 500px or under 400,000 pixels total, before OCR, on purpose — a
thumbnail comes back from the recogniser at confident-looking nonsense. Fill the
frame.

**The same file twice is a duplicate.** Re-uploading identical bytes is detected
and skipped, so the status stays `uploaded` and nothing appears to happen. Use a
different document.

**First document of the day is slow.** The model loads on first use (~30s). If
you want it warm before you present:

```sh
curl -s http://127.0.0.1:11434/api/generate \
  -d '{"model":"gemma3:4b","prompt":"hi","stream":false}' > /dev/null
```

**MinIO's console on http://localhost:9201 is a host-side tool.** It is not
reachable from the phone and is not meant to be. Same for Postgres on 55432.
Do not put either on screen expecting the phone to follow.

**Swagger is live** at `/api/docs` through the tunnel, if a question needs it.

---

## Documents through the tunnel

Uploading a document and having it read works completely — the upload, the OCR
and the extraction are all server-side.

What cannot work is a **presigned MinIO URL**. Those are signed with SigV4,
which signs the host header, so the hostname in the URL is fixed at signing time
and cannot be rewritten afterwards. With one tunnel there is no hostname that
both the API container and the phone can use, so any URL signed for
`minio:9000` is unreachable from the phone by construction.

This is handled: the API serves document originals itself on
`/api/patient-documents/:id/file`, on the same origin as everything else. That
is why the app needs only `MEDIHIVE_API`.

If a document viewer ever shows a broken image, the cause is a code path that
went back to presigning rather than to that route — not a tunnel or a MinIO
problem, and not something to debug on stage.

---

## When something does not come up

Work down this list. Stop at the first one that matches.

**`address already in use` on port 3000**
Something else has it — almost always `npm run start:dev`.
`ss -ltnp | grep :3000` names the process. Stop it and `up` again.

**`address already in use` on 9200 or 9201**
Another local service took it. Change the left-hand number in the `minio`
service's `ports:` in `docker-compose.demo.yml` and `up` again. Nothing depends
on those being any particular value.

**`api` stuck in `Restarting`**

```sh
docker compose -f docker-compose.demo.yml logs api | tail -40
```

- `🛑 Refusing to run the API server against a non-local database` — something
  is overriding `DATABASE_URL` to a remote host. Do **not** set
  `ALLOW_REMOTE_DB=1`; that would also unlock the production host that the
  tracked `.env` points at. Find the override instead.
- `"JWT_SECRET" length must be at least 32 characters` — an override is
  shadowing the compose value.

**`migrate` exited non-zero**

```sh
docker compose -f docker-compose.demo.yml logs migrate | tail -40
```

Then re-run just that step:

```sh
docker compose -f docker-compose.demo.yml up migrate
```

It is safe to run repeatedly.

**Sidecar health shows `"ollama": false`**
The host Ollama is bound to loopback. Step 0 fixes it. Confirm from inside:

```sh
docker exec hms_v2_api_demo wget -qO- http://host.docker.internal:11434/api/tags
```

**Sidecar health shows `"stt": false` or `"tts": false`**
The voices or the model cache did not mount.

```sh
docker exec hms_v2_sidecar_demo ls /app/voices
ls ~/.cache/huggingface/hub | grep faster-whisper
```

`ai-sidecar/voices/` must contain `en_US-lessac-medium.onnx`. It is gitignored,
so a fresh clone will not have it.

**Every document comes back "We couldn't read this document clearly"**
The API cannot reach the sidecar. Check both URL variables are set — the
document pipeline reads `MEDIHIVE_SIDECAR_URL` while case-taking reads
`AI_SIDECAR_URL`:

```sh
docker exec hms_v2_api_demo env | grep -i sidecar
```

Both must say `http://sidecar:8801`.

**Nuclear option — rebuild the demo data from nothing**

This destroys the demo database and reseeds it. It does **not** touch the
development stack in `docker-compose.local.yml`. Allow ten minutes; do not do
this with an audience waiting.

```sh
docker compose -f docker-compose.demo.yml down -v
docker compose -f docker-compose.demo.yml up -d --build
```

---

## What runs where

| Service    | Inside the network           | On the host                      | Reachable from the phone |
| ---------- | ---------------------------- | -------------------------------- | ------------------------ |
| API        | `api:3000`                   | `localhost:3000`                 | **yes — via ngrok**      |
| AI sidecar | `sidecar:8801`               | —                                | no                       |
| Postgres   | `postgres:5432`              | `localhost:55432`                | no                       |
| Redis      | `redis:6379`                 | —                                | no                       |
| MinIO      | `minio:9000`                 | `localhost:9200`, console `9201` | no                       |
| Ollama     | `host.docker.internal:11434` | `localhost:11434`                | no                       |

The development stack (`docker-compose.local.yml`, ports 5432/6379/9000/9001)
is untouched by all of this and can stay running.
