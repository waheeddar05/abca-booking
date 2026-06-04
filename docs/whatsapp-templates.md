# WhatsApp Notification Templates

PlayOrbit sends two kinds of WhatsApp messages:

- **Customer notifications** — delivered through **pre-approved BSP templates**
  (Meta Cloud API / Twilio). The body text lives on the BSP's servers; our
  code only fills the `{{1}}`, `{{2}}`, … parameters. **If the template's
  placeholder count doesn't match what the code sends, the message is
  rejected.** So whenever a template's parameter list changes here, the
  approved template on the BSP must be updated to match.
- **Staff notifications** (operator / coach / sidearm specialist / ground
  staff) — sent as **free-form text** (`sendWhatsAppText`), so the code has
  full control over the layout. No BSP template to keep in sync.

## Center name in every notification

Every notification names the **center** it relates to (ABCA vs Toplay vs …),
prominently, right after the title. Customer templates carry it as the
**leading body parameter `{{1}}`**; staff text messages put it on a dedicated
`🏢 Center: …` line under the title.

The center name is resolved in `src/lib/notifications.ts → resolveCenterName()`:
the caller passes `centerName` when it already has the loaded `center`
relation, or just `centerId` and the helper looks the name up (cached). If
neither resolves, it falls back to `PlayOrbit` so the template always receives
a value for `{{1}}`.

## Required customer template bodies (BSP)

Update these approved templates so their placeholders match the parameters the
code sends. The leading `{{1}}` is the center name in every case.

### `booking_detail` — 8 parameters

```
🏏 *Booking Confirmed!*
🏢 Center: {{1}}
📅 {{2}}
⏰ {{3}}
🎯 {{4}} — {{5}}
💰 {{6}}
👤 Operator: {{7}}
📞 Contact: {{8}}
📍 <maps link>
```

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Date (e.g. `Wed, 26 Mar 2026`) |
| `{{3}}` | Time (e.g. `04:00 PM – 04:30 PM (2 slots)`) |
| `{{4}}` | Machine / category headline |
| `{{5}}` | Facility / pitch |
| `{{6}}` | Price (+ kit info) |
| `{{7}}` | Operator / contact-person name |
| `{{8}}` | Operator / contact-person phone |

### `booking_cancelled` — 2 parameters

```
❌ *Booking Cancelled*
🏢 Center: {{1}}
{{2}}
If a refund applies, it will be credited to your wallet.
```

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Cancellation details (date/time/machine/cancelled-by/reason) |

### `payment_success` — 2 parameters

```
✅ *Payment Successful*
🏢 Center: {{1}}
{{2}}
```

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Payment / package activation message |

### `wallet_credit` — 4 parameters

```
PlayOrbit Wallet ({{1}}): ₹{{2}} credited. Reason: {{3}}. New balance: ₹{{4}}. Thank you!
```

| Param | Value |
|-------|-------|
| `{{1}}` | Center name |
| `{{2}}` | Amount credited |
| `{{3}}` | Reason |
| `{{4}}` | New balance |

> **Migration note:** Before this change the templates had one fewer parameter
> each (`booking_detail` had 7, `booking_cancelled`/`payment_success` had 1,
> `wallet_credit` had 3) and did not show the center. Re-submit each template
> with the center placeholder added as `{{1}}` (shifting the rest down by one).
> Until the BSP templates are updated, the BSP will reject these messages for a
> parameter-count mismatch — so update the templates and the code together.

## Staff text messages (no BSP template)

Format produced by `notifyAssignedStaffNewBooking` /
`notifyAssignedStaffBookingCancelled`:

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
