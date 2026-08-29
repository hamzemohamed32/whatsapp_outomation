# OpenWA Project Presentation

Use this as an 8–10 minute presentation and live-demo script.

## 1. The problem

HR and operations teams need timely WhatsApp notifications for absence, late arrival, missing check-in/out, approvals, and daily manager summaries. Manual sending is slow, inconsistent, and difficult to audit.

## 2. What this project is

OpenWA is a local, self-hosted WhatsApp API gateway. An HR system sends authenticated HTTP requests to OpenWA; OpenWA maintains the WhatsApp session, sends messages, receives events, and reports results through APIs and webhooks.

## 3. Main capabilities

- Multiple named WhatsApp sessions
- Text, images, video, audio, documents, reactions, groups, contacts, and status operations
- Bulk batches of up to 100 items per API request
- Templates, webhooks, plugins, API keys, roles, audit logs, health checks, metrics, and Swagger documentation
- Dashboard for local administration

## 4. HR automation flow

```text
Fingerprint/face device
        -> HR attendance database
        -> rule engine (late/absent/missing checkout)
        -> durable scheduled job queue
        -> OpenWA API
        -> employee, manager, and owner WhatsApp messages
        -> webhook/result stored in HR audit history
```

The HR system owns schedules and retry policy. OpenWA owns WhatsApp connectivity and delivery attempts.

## 5. Bulk-message behavior

- Default gap: 3 seconds plus a random 0–2 seconds, so normally 3–5 seconds between messages.
- Configurable gap: 1–60 seconds.
- The first item is sent immediately; the delay applies only between items.
- Every item can have a different recipient and message.
- OpenWA batches are immediate, in-process jobs. Exact future delivery times should be scheduled in the HR system's durable queue.

## 6. Reliability and security

- The saved browser profile is outside OneDrive at `C:\Users\xamse\AppData\Local\OpenWA\sessions`.
- Saved sessions auto-start after an API restart.
- API requests use an `x-api-key` header; keys must never be placed in frontend code or screenshots.
- Use HTTPS, restricted firewall rules, scoped API keys, backups, audit logs, and webhook signatures in production.
- Run each company in an isolated deployment/database/queue when strong failure and data isolation is required.

## 7. Honest limitation

The `whatsapp-web.js` engine automates WhatsApp Web and is not an official Meta sending API. High-volume or repetitive automation can be rate-limited or banned. Use conservative pacing, message only opted-in recipients, stop after blocks/complaints, and use the official WhatsApp Cloud API for high-scale SaaS production.

## 8. Live demo

1. Open `http://localhost:2785` and connect with the API key stored in `data/.api-key`.
2. Show that session `hamze` is **ready** without scanning another QR code.
3. Open `http://localhost:2785/api/docs` and show the Sessions, Messages, Templates, and Webhooks groups.
4. Send one message to a test number owned by the presenter.
5. Submit a 2–3 item bulk batch with a 3-second delay and random delay enabled.
6. Poll the returned `statusUrl` and show sent/failed/pending results.
7. Explain how an attendance event would create the same API job automatically.

## Closing statement

“This project gives us a working local WhatsApp automation gateway today. The next product layer is a durable, multi-company HR notification service around it, followed by an official Cloud API transport for production scale and lower account risk.”
