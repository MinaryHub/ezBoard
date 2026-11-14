# ezboard-contact

The relay behind ezBoard's **Help ▸ Contact the developers…**. The app posts a
message here; this sends it on through [Brevo](https://www.brevo.com)'s
transactional email API. Adapted from Kreate's relay (`MinaryHub/Kreate`,
`services/contact`).

Neither the Brevo key nor the address messages reach is in the app or in this
repository: both live only in the deployment's environment.

Deployed on Vercel as the project `ezboard-contact`. The app is built with
`https://ezboard-contact.vercel.app/api/contact` unless `VITE_CONTACT_URL`
says otherwise.

## Environment

| Variable | What |
|---|---|
| `BREVO_API_KEY` | A Brevo API key: Brevo ▸ Settings ▸ SMTP & API ▸ API Keys. |
| `CONTACT_TO` | Where messages go. |
| `CONTACT_FROM` | The sender. Brevo only sends from a sender it has verified. |
| `CONTACT_FROM_NAME` | The sender's name. Optional; `ezBoard`. |

```sh
cd services/contact
vercel env add BREVO_API_KEY production
vercel env add CONTACT_TO production
vercel env add CONTACT_FROM production
vercel deploy --prod
```

Until all three are set the relay answers `503 the contact service is not set
up`, and the app shows that under the form.

## What it accepts

`POST /api/contact` with `x-ezboard-client: ezboard/<version>` and a JSON body
`{ kind: "bug" | "feature" | "question" | "other", message, name?, email?, version?, platform? }`.
It answers CORS preflight (`OPTIONS`) because the app's interface is a web view.
Limits: 5000-character messages, five messages per address per ten minutes,
a hidden `website` field that only bots fill in.

## Tests

```sh
npm test
```
