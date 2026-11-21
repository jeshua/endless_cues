# The Endless Cues service protocol

Version 1 · written 2026-11-16, section 7 built the same day · the contract between the Endless Cues app and the Endless Cues service.

**Licence.** This document (and only this document) may be used, copied and implemented under the MIT licence.
Copyright © 2026 Jeshua Bratman, who holds all copyright in it. It is the only thing the app (GPL-3.0, public)
and the service (private) share: the service is written against this page, not against the app's code, so it
contains no GPL code; the app may implement its side of it without taking anything from the service.

The same text lives in two places and changes in both at once, in one commit each:
`PROTOCOL.md` in the service repository (`endless_cues_service`), and `docs/specs/17-service-protocol.md` in the
app repository (`endless_cues`).

Status: reports, sign-in (the email link and the device flow), device tokens and the admin API are **deployed**
(2026-11-16). The hosted assistant and the usage counter are **built and tested locally** (section 7).
Subscriptions and billing are **interfaces only**: they answer `501` until they are built.

## 1. Hosts, versions, conventions

| Host | What |
|---|---|
| `https://api.endlesscues.com` | The JSON API. Every path starts `/v1/`. What the app talks to. |
| `https://account.endlesscues.com` | The account site: HTML pages for people (sign in, connect a computer, your computers; the admin's reports). The app only ever opens it in the browser. |
| `https://endlesscues.com` | The website (static). No API. |

- **Versioning.** The path carries the major version (`/v1/`). Within v1, fields may be **added** to responses and
  optional fields to requests; nothing is removed or changes meaning. A client must ignore fields it does not know.
  A breaking change is `/v2/`, and `/v1/` keeps working for at least six months after it exists. Every API
  response carries `x-ec-api: 1`.
- **Requests** are JSON (`Content-Type: application/json`, at most 16 KB) except a report, which is
  `multipart/form-data`. Anything else is `415`.
- **Times** are ISO 8601 in UTC (`2026-11-16T20:00:00.000Z`).
- **No CORS.** The API sends no `Access-Control-*` headers: it is called from the app's main process (Node's
  `fetch`), never from a web page. A browser page on another site cannot read its answers.
- The app identifies itself in every request with `User-Agent: EndlessCues/<version> (<os>)`. It is informative only.

## 2. Errors

Every error from the API has one shape:

```json
{ "error": "rate_limited", "message": "That's a lot of reports in an hour. Try again later; nothing was lost on your side.", "retry_after": 1834 }
```

- `error`: a stable machine code (below). The app decides what to do from this, never from `message`.
- `message`: one plain sentence a person can be shown as it is. It may change wording at any time.
- Some errors add fields: `retry_after` (seconds), `limit_bytes`, `interval`.

| Status | `error` | Meaning |
|---|---|---|
| 400 | `bad_json`, `bad_form`, `bad_<field>` (`bad_client_id`, `bad_category`, `bad_email`, `bad_context`, `bad_image`, `bad_status`, …), `empty_report`, `invalid_request`, `build_not_allowed` | The request is wrong; sending it again will not help. |
| 400 | `authorization_pending`, `slow_down`, `access_denied`, `expired_token`, `invalid_grant` | The device flow's answers (section 4.3), as RFC 8628 names them. |
| 401 | `unauthorized` | No token, or a token that is unknown or was removed. The app forgets its token and offers Sign in. |
| 403 | `bad_origin` | A form posted to the account site from somewhere else. |
| 404 | `not_found` | No such thing, **or** not yours to see (an admin route asked by a non-admin answers 404, not 403). |
| 413 | `too_large` (or `bad_image`) | Over a size limit; `limit_bytes` says which. |
| 415 | `unsupported_media_type` | Not the content type the endpoint takes. |
| 429 | `rate_limited`, `turn_too_long`, `allowance_used` | Too many. `Retry-After` header and `retry_after` field, in seconds. Wait that long; do not retry sooner. |
| 501 | `not_implemented` | The endpoint is part of the protocol but not built yet. |
| 5xx | `server_error`, `email_failed`, `not_configured`, `try_again`, `upstream_error`, `upstream_rejected`, `busy_today` | The service's fault (or the model's). Try again later; never in a tight loop. |

**Retrying.** The app retries only on a network failure, `429` (after `retry_after`) and `5xx`, at most three times,
waiting at least 30 seconds, then 2 and 10 minutes, and only while it is open. Never on `4xx` otherwise.

## 3. Reports: anyone may send one

`POST /v1/reports` · no account needed · `multipart/form-data`

A bug, an idea, or anything else, from inside the app ("Report a problem"), with a screenshot if the person wants
one. Anyone who has the app may send one. If the app is signed in it may add `Authorization: Bearer <device token>`
and the report is linked to the account; it is accepted the same either way.

| Field | | |
|---|---|---|
| `client_id` | required | 8–80 of `A–Z a–z 0–9 _ . : -`. Made once per install (a random UUID is right) and kept in the app's own settings. It identifies an install, not a person, and is not tied to anything else. |
| `submission_id` | recommended | Same alphabet. Made once per report. Sending the same `client_id` + `submission_id` again returns the first report (`200`, `"created": false`) and stores nothing new: a retry is safe. |
| `category` | `bug` (default), `idea` or `other` | |
| `comment` | text | What the person wrote. Up to 5,000 characters (longer is cut). A report must have a comment or a screenshot. |
| `app_version` | required | `package.json`'s version, e.g. `0.2.0-alpha.1`. At most 40 characters. |
| `os` | required | e.g. `macOS 15.1 arm64`, `Windows 11 x64`. At most 80 characters. |
| `email` | optional | Only if the person ticks "you can write back to me" and types an address. |
| `captured_at` | optional | When the screenshot was taken (or the form opened). |
| `context` | optional | A JSON **object**, at most 64 KB as text. What the app knew at the time (below). |
| `screenshot` | optional file | **`image/webp`, a still image, at most 2400 px on its long side, at most 8 MB.** |
| `thumbnail` | optional file | `image/webp`, at most 480 px on its long side, at most 256 KB. Only with a screenshot. |

The whole request is at most 8.75 MB; a larger one is refused (`413`) before it is read.

**The screenshot is made by the app, not by the service.** The service does not decode or re-encode images; it
checks the file's own header (RIFF/WEBP, the size it says it is, not animated, its width and height) and refuses
anything else, so a PNG, a JPEG, an SVG or a file named `.webp` that is not one is `400 bad_image`. In Electron:
`webContents.capturePage()` gives a `NativeImage`; draw it on a canvas scaled to fit 2400 px and
`canvas.toBlob(cb, 'image/webp', 0.84)`; the thumbnail the same at 480 px and `0.72`. Let the person see the
picture before it is sent and remove it.

**What the app puts in `context`** (all optional; keep it small):

```jsonc
{
  "view": "cue list",                      // which tab or page was open
  "mode": "edit",                          // edit or show
  "selected_cue": { "number": "7", "type": "audio" },
  "cue_count": 64,
  "audio": { "device": "built-in", "sample_rate": 48000 },
  "locale": "en-GB",
  "errors": ["the last few error messages the app itself logged, at most 20, each at most 500 characters"],
  "issue": "the one error line the app offered to report (\"Something went wrong. Report it?\"), at most 500 characters",
  "show_log": ["the show log's last lines, only if the person ticked it: times, cue numbers and what happened, every cue and file name replaced; at most 150"],
  "show_name": "only if the person ticked “include my show's name”"
}
```

**What the app must never send in a report:** a show file or any part of one beyond the line above, a cue's
notes or names (beyond the one selected cue's number and type), any media (sounds, video, images other than the
screenshot the person saw), file paths that contain a user name (send the file name only, or nothing), a device's
address or password, an API key or token of any kind (the device token goes only in the `Authorization` header),
the assistant's conversation, or anything the person has not been shown. The show's name is sent only if the
person ticks a box that says so, and goes in `context.show_name`.

**Answers.**

```
201 { "id": 42, "status": "open", "created_at": "2026-11-16T20:00:01.000Z", "created": true }
200 { "id": 42, "status": "open", "created_at": "…", "created": false }     a retry of the same submission
```

**Limits on this open endpoint.** Counted before the body is read, so a refused request costs the service one
counter write:

| Limit | |
|---|---|
| per address | 10 an hour and 30 a day (IPv4 by address; IPv6 by its /64) |
| per install (`client_id`) | 30 a day |
| everyone together | 1,000 a day (a setting, `REPORTS_PER_DAY_ALL`) |

Past any of them: `429 rate_limited` with `retry_after`. The app keeps the report on disk and offers to send it
later; it does not retry on its own more than section 2 says.

**How the app does it** (added from building the app's side; nothing here changes what the service accepts):

- The email field is one box, "Email, if you'd like a reply": typing an address is the consent; an empty box sends
  no `email` field.
- `context.view` is free text naming what was on screen: `cue list`, `rig`, `live`, or `settings: <page>`, with
  ` + <name> drawer` when a drawer was open. `context.audio` may carry `"ok": false` when the output had failed.
- Every string in `context` the app wrote (the error lines, the output's name) is scrubbed before it is shown or
  sent: the home folder becomes `~` and what follows it only the file's name (`~/…/show.json`), the user's login
  name `<user>`, a network address `<address>`, an email `<email>`, anything shaped like a key or token `<key>`. What
  the person typed is sent as they typed it.
- A report kept on disk is tried again about 30 s after the app next opens; that counts as the first of section 2's
  three automatic tries. Pressing Send sends the new report and every one waiting, whatever their `retry_after`
  (a person asking is not a loop). One the service refuses with a `4xx` other than `429` is moved aside, never
  deleted and never tried again by itself.
- Sending again after a failure reuses the `submission_id`, even if the person changed the words in between: if
  the first attempt did in fact arrive, the service keeps the first words. Rare (the app saw no answer), and the
  safe way round.

## 4. Accounts

An email address is the account. There are no passwords. Every token the service hands out is 32 random bytes
with a readable prefix (`ecl_` a sign-in link, `ecs_` a session, `ecc_` a device code, `ecd_` a device token);
the service stores only each token's SHA-256 and never logs one.

### 4.1 Sign-in link (the account site)

`POST /v1/auth/start` `{ "email": "x@example.com", "return_to": "/connect?code=QXRM-7KPD" }` → `202`
`{ "ok": true, "message": "If that address is right, a link to sign in is on its way." }`

The same answer whether or not the address has an account. The account site's own form (`POST /signin`) does the
same. The email holds one link, `https://account.endlesscues.com/auth/verify?t=ecl_…`, which works **once**, for
**15 minutes**. Opening it shows a "Sign in as x@example.com?" button; the button (a `POST`) uses the link, so a
mail scanner that opens every link cannot spend it. Using it creates the account if there is none and sets the
session cookie: `__Host-ec_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`, 30 days. `return_to` must be a
path on the account site; anything else goes to `/account`.

Limits: 5 links an hour to one address, 10 an hour from one network address.

### 4.2 The account site's pages (for people, not the app)

`/signin`, `/auth/verify`, `/connect` (confirm a computer's code), `/account` (your computers, each with
**Remove**), `/signout`, and for admins `/admin/reports`. Every change is a form posted from the account site
itself (a form from any other origin is `403`). No scripts.

### 4.3 The device flow (how the app signs in)

RFC 8628's shape. 1. The app asks for a code:

`POST /v1/auth/device/start` `{ "name": "Stage manager's MacBook" }` →

```json
{ "device_code": "ecc_…", "user_code": "QXRM-7KPD",
  "verification_uri": "https://account.endlesscues.com/connect",
  "verification_uri_complete": "https://account.endlesscues.com/connect?code=QXRM-7KPD",
  "expires_in": 900, "interval": 5 }
```

2. The app shows `user_code` (large, with the dash) and opens `verification_uri_complete` in the browser. The
person signs in there if they are not already (4.1) and is asked "Connect *Stage manager's MacBook* to
x@example.com?" with the same code on the page.

3. The app polls, no faster than `interval` seconds:

`POST /v1/auth/device/poll` `{ "device_code": "ecc_…" }`

| Answer | Means | The app |
|---|---|---|
| `400 authorization_pending` | not confirmed yet | waits `interval`, asks again |
| `400 slow_down` (`interval`) | asked too fast | uses the new `interval` |
| `400 access_denied` | the person said no | stops, says so |
| `400 expired_token` | 15 minutes passed | stops, offers to start again |
| `400 invalid_grant` | unknown, or the token was already handed out | stops |
| `200` | confirmed | keeps the token, stops polling |

```json
{ "token": "ecd_…", "token_type": "Bearer",
  "device": { "id": 12, "name": "Stage manager's MacBook" },
  "account": { "email": "x@example.com", "role": "user" } }
```

The token is handed out **once**. The app keeps it in the OS keychain (`safeStorage`, as `cloud:token`), never in
a show file and never in a log. An account may have **5** computers; a sixth is refused on the account site with
"remove one first".

### 4.4 Using the device token

Every authenticated call: `Authorization: Bearer ecd_…`.

| Call | |
|---|---|
| `GET /v1/me` | `{ "account": { "email", "role" }, "device": { "id", "name" } }`. `401` means the token is gone: forget it. |
| `GET /v1/devices` | `{ "devices": [ { "id", "name", "created_at", "last_used_at", "this": true } ] }`: the account's computers. |
| `DELETE /v1/devices/self` | Sign out: revokes this token at once. `{ "ok": true, "revoked": 12 }` |
| `DELETE /v1/devices/<id>` | Removes another computer of the same account (`404` for anyone else's). |

A token is long-lived and has no expiry; it ends when it is removed (here, on the account page, or by signing out
in the app) or the account is closed.

### 4.5 Roles

`role` is `admin` for the addresses the service is configured with (a secret, `ADMIN_EMAILS`), otherwise `user`.
It is worked out on every request; nothing a client sends can change it.

## 5. The admin API

For the owner's tools (the `worker/bin/reports.js` CLI). An admin's device token, or the admin's session cookie on
the account site. Anyone else: `404` (and `401` with no credentials at all).

| Call | |
|---|---|
| `GET /v1/admin/reports?status=open,in_progress&category=bug&limit=50&offset=0` | Newest first. `status` is one, several comma-separated, or `all` (the default); `limit` at most 200. `{ "items": [ … ], "total": 12, "counts": { "open": 9, "in_progress": 2, "fixed": 1, "wont_fix": 0 } }`. Items have everything but `context` (a `summary` instead) and `has_screenshot`, `has_thumbnail`. |
| `GET /v1/admin/reports/<id>` | One in full, `context` included. |
| `PATCH /v1/admin/reports/<id>` `{ "status": "fixed", "note": "Fixed in 0.2.1." }` | Either or both. Statuses: `open`, `in_progress`, `fixed`, `wont_fix`. Returns the report. |
| `GET /v1/admin/reports/<id>/screenshot[?thumb=1]` | `image/webp` (the thumbnail falls back to the picture). Served with `nosniff` and a sandboxing CSP. |

## 6. Privacy

- **Reports**: what the person typed, the context above, the screenshot they saw, their app version and system,
  and an email address only if they gave one. Kept until the owner deletes them. Read only by the owner.
- **Network addresses** are never stored: rate limits count a keyed hash (HMAC) of the address, in windows of an
  hour or a day, deleted after three days.
- **Accounts**: the email address, when it was made and last signed in, each computer's name and last use (to the
  hour). Tokens only as SHA-256 hashes.
- **Email** is sent through Cloudflare Email Service for sign-in links only. No newsletters from this.
- **No logs of content.** The service writes no request or response body, token, email address or network address
  to any log; Workers Logs are off. A test fails if a report's words or an address appear in the console.
- To delete an account and everything linked to it: email the owner. (A self-serve button is planned.)

## 7. The hosted assistant

Built 2026-11-16 (tested locally against a stand-in for the model; not yet deployed). The app keeps its own
agent loop: it sends one model call at a time and runs the tools itself; the service chooses the model, pays for
it, counts it and passes the answer back. It keeps no conversation.
Its design (`docs/16-hosted-assistant.md`) is in the service repository.

### 7.1 A model call

`POST /v1/chat/completions` (device token) · `application/json`, at most **1 MB**. `POST /v1/messages` is the same
call (the name this section gave it before it was built).

The request is OpenAI's **Chat Completions** shape, the one the app already sends any OpenAI-compatible service:

```jsonc
{ "model": "anything",                  // ignored: the service chooses
  "messages": [ { "role": "system", "content": "You are the assistant inside Endless Cues, a show-control application…" },
                { "role": "user", "content": "…" },
                { "role": "assistant", "content": null, "tool_calls": [ … ], "ec_state": "…" },
                { "role": "tool", "tool_call_id": "call_…", "content": "…" } ],
  "tools": [ { "type": "function", "function": { "name": "read_show", "description": "…", "parameters": { … } } } ],
  "tool_choice": "auto" }
```

Only these fields: `model`, `messages`, `tools`, `tool_choice` (`"auto"` only), `stream` (`false` only: no
streaming), `max_tokens`, `max_completion_tokens`, `parallel_tool_calls` (the last three are ignored: the service
sets them). Anything else is `400 invalid_request`.

Request headers:

| Header | |
|---|---|
| `Authorization: Bearer ecd_…` | required |
| `x-ec-turn` | required: one id for every call of one turn (8–80 of `A–Z a–z 0–9 _ . : -`; a random UUID is right) |
| `x-ec-step` | 0, 1, 2… within the turn |
| `x-ec-version` | the app's version |

**Is it the app's?** The first message is the only `system` message and starts with the app's opening sentence,
and every tool is one of the app's tools (the service holds both, as settings). Otherwise `400 build_not_allowed`:
"This build can't use the hosted assistant. Use your own key." The app is open source, so this cannot tell the app
from a copy of it; it keeps the service from being a general model endpoint, and the caps (7.3) bound what anyone
can cost. A release that adds a tool is accepted once the service knows the tool's name.

**The answer** is a Chat Completions answer: `choices[0].message` with `content` (text or `null`) and
`tool_calls`; `finish_reason` `tool_calls`, `stop`, `length` (cut off) or `content_filter` (refused); `usage` in
tokens; `model` names the model that answered. One field is added: `message.ec_state`, an opaque string (the
model's reasoning for that step). **Send each assistant message back exactly as it came, `ec_state` included**;
the model then carries its reasoning through the turn. A client that drops it still works, a little less well.

Response headers:

| Header | |
|---|---|
| `x-ec-tier` | `allowance` (the main model) or `after` (the smaller one, past the allowance) |
| `x-ec-used` | 0–100: this month's share of the allowance |
| `x-ec-resets` | when the month ends and the allowance starts again (ISO 8601) |

### 7.2 Usage

`GET /v1/usage` (device token) →

```json
{ "period_start": "2026-11-01T00:00:00.000Z", "period_end": "2026-12-01T00:00:00.000Z",
  "used_percent": 23, "tier": "allowance", "asks_used": 23, "asks_allowance": 100 }
```

`tier` is what the next ask gets: `allowance`, `after` or `used_up`. Never dollars or tokens.

### 7.3 The month, and the caps

During the beta every signed-in account has, each calendar month (UTC):

1. **An allowance of asks** on the main model (today 100 asks on `gpt-6.1-terra`). An ask is a turn: one
   question and every model call it takes. It is counted on the turn's first call that the model answers.
2. **Then a smaller model** (today `gpt-6-luna`) for a further number of asks (today 300).
3. **Then a stop** until the 1st: `429 allowance_used`, with `resets_at` and `retry_after`.

A turn keeps the model it started on to its end, so a turn under way when the allowance runs out finishes.
The service also stops an account early if its model cost for the month reaches a ceiling, and stops everyone
for the rest of the UTC day if the day's total reaches another (`503 busy_today`). The models and every number
are the service's settings and may change; the app shows what the headers and `/v1/usage` say.

| Limit | Answer |
|---|---|
| 20 calls a minute, 300 an hour, per account | `429 rate_limited` "Slow down a moment." |
| 40 calls in one turn | `429 turn_too_long` "That took too many steps. Ask for it in smaller pieces." |
| Request over 1 MB | `413 too_large` |
| The month (above) | `429 allowance_used` "This month's asks are used up. Back on 1 December." |
| The day, everyone | `503 busy_today` |
| The model does not answer | `502 upstream_error` "The Endless Cues assistant isn't answering. Your show isn't affected." |
| The model refuses the request | `502 upstream_rejected` "The assistant couldn't take that request. Clear the conversation and ask again." |
| No model set up | `503 not_configured` |

### 7.4 What is kept

Per model call: the account, the computer, the time, the turn id and step, the app version, the model, the tier,
the token counts by kind, the cost worked out from the model's price, the status and the model service's request
id. **Never a request or a response body**, and nothing of either in a log. Calls are kept 30 days, then added
into a monthly total per account and model, kept 18 months. The model is OpenAI's, called with `store: false`;
OpenAI sees the content of each call and keeps API data as its terms say.

### 7.5 Not built yet

| Call | Will be |
|---|---|
| `GET /v1/subscription` (token) | `{ "status": "none\|beta\|active\|past_due\|canceled", "period_end", "manage_url" }` (501 today) |
| `POST /v1/billing/webhook` | Paddle's webhook (signature checked; each event id once). Not called by the app. (501 today) |

When billing exists, an account whose subscription has ended gets `402 subscription_inactive` from 7.1.
