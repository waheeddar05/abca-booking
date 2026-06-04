# WhatsApp Notification Templates

PlayOrbit sends two kinds of WhatsApp messages:

- **Customer notifications** — delivered through **pre-approved BSP templates**
  (Meta Cloud API / Twilio). The body text lives on the BSP's servers; our
  code only fills the `{{1}}`, `{{2}}`, … parameters. **If the template's
  placeholder count doesn't match what the code sends, the message is
  rejected.**
- **Staff notifications** (operator / coach / sidearm specialist / ground
  staff) — sent as **free-form text** (`sendWhatsAppText`), so the code has
  full control over the layout. No BSP template involved.

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

## Staff text messages (no BSP template)

Format produced by `notifyAssignedStaffNewBooking` /
`notifyAssignedStaffBookingCancelled` — full control, dedicated center line:

```
🏏 *New Booking*
🏢 Center: <center name>
Hi <staff name> (<role>),
A new booking has been assigned to you.

👤 Customer: …
📅 Date: …
⏰ Time: …
⏳ Duration: …
📍 Facility: …
🎯 Type: …
```
