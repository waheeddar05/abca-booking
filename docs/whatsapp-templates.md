# WhatsApp Notification Templates

PlayOrbit sends two kinds of WhatsApp messages:

- **Customer notifications** — delivered through **pre-approved BSP templates**
  (Meta Cloud API / Twilio). The body text lives on the BSP's servers; our
  code only fills the `{{1}}`, `{{2}}`, … parameters. **If the template's
  placeholder count doesn't match what the code sends, the message is
  rejected.**
- **Staff notifications** (operator / coach / sidearm specialist / ground
  staff) for **new bookings and cancellations** — also delivered through an
  **approved template**.

  > **Why a template and not free-form text?** WhatsApp (both Meta and Twilio)
  > only delivers **free-form** text to a recipient who messaged the business
  > in the last 24 hours. Staff almost never do, so the old free-form-only
  > path was silently dropped for them ("outside 24h window") while customers
  > — who get a template — received theirs. **Approved templates deliver
  > regardless of the 24-hour window**, so staff alerts now go through one.

  By default the staff alert **reuses an approved customer template**
  (`booking_detail` for new bookings, `booking_cancelled` for cancellations)
  — no new BSP approval needed, works immediately. To send a richer,
  staff-specific message (including the customer's name + phone), set the
  `WHATSAPP_STAFF_BOOKING_TEMPLATE` / `WHATSAPP_STAFF_CANCEL_TEMPLATE` env
  vars to dedicated approved templates (see contracts below). A **free-form
  text** (`sendWhatsAppText`) is kept only as a best-effort fallback when the
  template send fails or the provider isn't configured.

## Center name in every notification

Every notification names the **center** it relates to (ABCA vs Toplay vs …) so
recipients can tell at a glance which center a message is about.

> **No BSP template changes are required.** The approved customer templates
> keep their existing parameter counts (`booking_detail` = 7,
> `booking_cancelled` = 1, `payment_success` = 1, `wallet_credit` = 3). The
> center name is **embedded into an existing parameter** rather than added as a
> new placeholder. Staff text messages put the center on its own dedicated
> `🏢 Center: …` line (no template to keep in sync).

The center name is resolved in `src/lib/notifications.ts → resolveCenterName()`:
the caller passes `centerName` when it already has the loaded `center`
relation, or just `centerId` and the helper looks the name up (cached). If
neither resolves, it falls back to `PlayOrbit`.

## How the center name appears (customer templates)

### `booking_detail` — 7 params (unchanged)

Center name is prepended to `{{1}}` (the date), so it renders on the first
line right under the title:

```
🏏 *Booking Confirmed!*
📅 ABCA Cricket Academy • Wed, 26 Mar 2026
⏰ 04:00 PM – 04:30 PM (2 slots)
🎯 Yantra — Astro Turf
💰 ₹500
👤 Operator: …
📞 Contact: …
📍 <maps link>
```

| Param | Value |
|-------|-------|
| `{{1}}` | **`<Center> • <date>`** |
| `{{2}}` | Time |
| `{{3}}` | Machine / category headline |
| `{{4}}` | Facility / pitch |
| `{{5}}` | Price (+ kit info) |
| `{{6}}` | Operator / contact-person name |
| `{{7}}` | Operator / contact-person phone |
| `{{8}}` | **Center map link** — *only when the location param is enabled (below)* |

#### Per-center location — optional `{{8}}` (opt-in)

`booking_detail` historically ends with a **static** "📍 maps link" baked into
the template body, so every center's confirmation rendered that one (ABCA)
location — wrong for Toplay and any other center. To show each center's **own**
map:

1. On the BSP, re-approve `booking_detail` with the footer changed from a
   hardcoded link to a placeholder: `📍 {{8}}` (an 8th body parameter).
2. Set `WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED=true`.

The code then fills `{{8}}` with the **booking center's `mapUrl`** (falling
back to "Location shared at the center" when a center has none), for both the
customer confirmation and the staff alert. Until the flag is `true` the code
sends the legacy **7** params, so the existing template keeps working — flip
the flag **only after** the template is re-approved with `{{8}}`, or Meta will
reject every confirmation for a param-count mismatch.

### `booking_cancelled` — 1 param (unchanged)

Center name leads the `{{1}}` detail string:

```
Your PlayOrbit booking has been cancelled: ABCA Cricket Academy • Wed, 26 Mar 2026 | 04:00 PM – 04:30 PM | Machine: Yantra | Cancelled by: …. If a refund applies, it will be credited to your wallet.
```

### `payment_success` — 1 param (unchanged)

Center name leads the `{{1}}` message string:

```
ABCA Cricket Academy • Your "Monthly 10" package (10 sessions) is now active. Validity starts from …
```

### `wallet_credit` — 3 params (unchanged)

`{{1}}` (amount) and `{{3}}` (balance) render with a `₹` prefix and must stay
numeric, so the center name is folded into the `{{2}}` reason:

```
PlayOrbit Wallet: ₹500 credited. Reason: ABCA Cricket Academy • Booking cancellation refund. New balance: ₹1200. Thank you!
```

| Param | Value |
|-------|-------|
| `{{1}}` | Amount |
| `{{2}}` | **`<Center> • <reason>`** |
| `{{3}}` | New balance |

## Per-center location button (optional — `WHATSAPP_BOOKING_TEMPLATE`)

> **Two ways to show a per-center location — pick one.** This button approach
> and the [`{{8}}` body param](#per-center-location--optional-8-opt-in) above
> are alternative solutions to the same problem; you don't need both. The code
> gives the button **precedence**: when `WHATSAPP_BOOKING_TEMPLATE` is set the
> confirmation uses that template + button and ignores the `{{8}}` flag;
> otherwise it falls back to `booking_detail` (with `{{8}}` if
> `WHATSAPP_BOOKING_DETAIL_LOCATION_ENABLED=true`). The button avoids touching
> the already-approved `booking_detail` at all — that's the "add one more
> template" path.

By default `booking_detail` carries a **static** map link baked into its
template body — the *same* location for every center. To show each center its
**own** location, create a newer approved template that has a dynamic **"View
Location"** URL button and point `WHATSAPP_BOOKING_TEMPLATE` at it. Until that
env var is set, nothing changes (customers keep getting `booking_detail`), so
the code is safe to ship ahead of approval.

### Why a redirect route instead of the map link directly on the button

WhatsApp dynamic URL buttons only allow a **fixed base URL + a variable
suffix** — the variable must sit at the very end of the URL. Per-center Google
Maps links (`https://maps.app.goo.gl/…`) share no common prefix, so they can't
go on the button as-is. Instead the button points at a fixed PlayOrbit URL and
the code appends the center **slug**:

```
button URL (on the template):  https://www.playorbit.in/loc/{{1}}
code supplies suffix {{1}}  =  <center slug>   (e.g. "abca", "toplay")
final URL the user taps     =  https://www.playorbit.in/loc/abca
```

`GET /loc/[slug]` (`src/app/loc/[slug]/route.ts`) looks the center up by slug
and **307-redirects** to its `mapUrl`, falling back to the platform-wide
`LOCATION_URL` for an unknown slug / missing mapUrl (so the button is never
dead). The route is public + maintenance-allowed.

### Template contract (create on Meta, then set the env var)

Name it anything (e.g. `booking_detail_loc`) and set `WHATSAPP_BOOKING_TEMPLATE`
to that name. Body = the **same 7 params** as `booking_detail`, just without
the static `📍 maps link` line (the button replaces it):

| Param | Value |
|-------|-------|
| `{{1}}` | `<Center> • <date>` |
| `{{2}}` | Time |
| `{{3}}` | Machine / category headline |
| `{{4}}` | Facility / pitch |
| `{{5}}` | Price (+ kit info) |
| `{{6}}` | Operator / contact-person name |
| `{{7}}` | Operator / contact-person phone |

Suggested body:

```
🏏 *Booking Confirmed!*
📅 {{1}}
⏰ {{2}}
🎯 {{3}} — {{4}}
💰 {{5}}
👤 Operator: {{6}}
📞 Contact: {{7}}
```

Button — **Call-to-action → Visit website → Dynamic**:

| Field | Value |
|-------|-------|
| Button text | `View Location` |
| URL type | **Dynamic** |
| URL | `https://www.playorbit.in/loc/{{1}}` (the `{{1}}` suffix is the center slug) |

The code fills the button as a `button` component (`sub_type: 'url'`,
`index: '0'`) whose single text parameter is the center slug.

### Rollout

1. Set each center's **mapUrl** in super admin → `/admin/centers/[id]` → General.
2. Create + submit the template above on Meta; wait for approval.
3. Set `WHATSAPP_BOOKING_TEMPLATE=<template name>` in the environment. New
   customer confirmations immediately use the new template + per-center button.

> Requires the **Meta Cloud API** provider (the active notification provider).
> Twilio's path sends free-form text and ignores template buttons.

## Staff new-booking alerts (approved template)

`notifyAssignedStaffNewBooking` delivers an in-app notification (always) plus
an approved-template WhatsApp message to every assigned staff member (machine
operator / coach / sidearm specialist) and the center's ground staff for
floor-handled categories (Cricket Net / Full Court / Sidearm / Coaching).

### Default — reuse `booking_detail` (7 params, already approved)

Staff receive the **same approved template the customer gets**, so no new BSP
approval is needed. The one difference from the customer's send: the
**customer's name + phone are folded into the facility param ({{4}})** —
`booking_detail` has no dedicated slot for the booker, and {{4}} carries no
misleading baked label — so the staff alert identifies who booked and how to
reach them. Params for the staff send:

| Param | Value |
|-------|-------|
| `{{1}}` | `<Center> • <date>` |
| `{{2}}` | Time (+ `(N slots)` for multi-slot) |
| `{{3}}` | Booking type (e.g. "Sidearm Session") / machine headline |
| `{{4}}` | `<Facility> • Booked by <customer> (<phone>)` |
| `{{5}}` | Price (or "Pay at center" / "Package session" / "FREE") |
| `{{6}}` | On-ground contact name (operator / specialist / coach) |
| `{{7}}` | On-ground contact phone |

> For a fully staff-shaped message — customer name + phone in their own fields,
> a staff-worded body (no "Booking Confirmed!" header) — set a dedicated
> template (below) instead of folding the booker into {{4}}.

### Optional — dedicated staff template (`WHATSAPP_STAFF_BOOKING_TEMPLATE`)

Set the env var to the name of a **separately approved** template to send staff
a richer, role-aware message. The code fills **8 body params** in this order —
create the template's body to match:

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Staff role (e.g. "Machine Operator", "Personal Coach", "Trainer Specialist", "Ground Staff") |
| `{{3}}` | Customer name |
| `{{4}}` | Customer phone |
| `{{5}}` | Date |
| `{{6}}` | Time (+ `(N slots)`) |
| `{{7}}` | Booking type |
| `{{8}}` | Facility |

Suggested body:

```
🏏 New booking at {{1}}
🙌 Role: {{2}}
👤 Customer: {{3}} ({{4}})
📅 {{5}} ⏰ {{6}}
🎯 {{7}} · 📍 {{8}}
```

## Staff cancellation alerts (approved template)

`notifyAssignedStaffBookingCancelled` delivers an in-app notification (always)
plus an approved-template WhatsApp message to every assigned staff member and
the center's ground staff — the same delivery model as the new-booking alert,
so cancellations reach staff even outside the 24-hour window.

### Default — reuse `booking_cancelled` (1 param, already approved)

The recipient gets the approved customer `booking_cancelled` template with a
staff-oriented detail string folded into `{{1}}`:

| Param | Value |
|-------|-------|
| `{{1}}` | `<Center> • <role> session cancelled \| Customer: … \| <date>, <time> \| <facility> \| Cancelled by: … \| Reason: …` |

### Optional — dedicated staff-cancel template (`WHATSAPP_STAFF_CANCEL_TEMPLATE`)

Set the env var to a **separately approved** template for a richer, role-aware
message. The code fills **8 body params** in this order — create the
template's body to match:

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Staff role (e.g. "Machine Operator", "Trainer Specialist") |
| `{{3}}` | Customer name |
| `{{4}}` | Customer phone |
| `{{5}}` | Date |
| `{{6}}` | Time |
| `{{7}}` | Booking type |
| `{{8}}` | Cancelled by |

### Free-form fallback

The same emoji-formatted free-form text is kept as a best-effort fallback
(used only when the template send fails or the provider isn't configured):

```
❌ *Booking Cancelled*
🏢 Center: <center name>
Hi <staff name> (<role>),
A booking assigned to you has been cancelled.

👤 Customer: …
📞 Phone: …
📅 Date: …
⏰ Time: …
📍 Facility: …
• Category: … / Machine: … / Pitch: … / …
🚫 Status: Cancelled
🙍 Cancelled by: …
```
