# CTI Casefile 012 — The Copy That Left the Building

A single-page, browser-based **cyber threat intelligence investigation simulator**,
built from the scenario spec in `new.scenario`.

You are a Tier 1 escalation analyst. A USB device was attached to a finance
workstation, 200 files were copied onto it, and the device was pulled five minutes
later. You get the raw event stream, three alerts, an account record and an estate
baseline for removable media. You have to work out what left the building, prove it,
name it, and write an assessment someone else can act on.

One case, six stages, 100 XP, about 25 minutes.

**No account. No setup. No terminal. No Wireshark, no VM, no SIEM licence.**

---

## Play it

The case runs entirely in the browser — no build step, no installation, no account.
Progress is saved locally to the browser only.

Open `index.html` in any current browser and press **BEGIN INVESTIGATION**. It also
runs from a local disk over `file://`, and deploys unchanged as a static page (GitHub
Pages, Netlify, or any web server).

---

## The case

At 08:02:11 `mchen` — a Finance Analyst with no removable-media exemption on record —
logged on interactively to `sec-win-04`. Two minutes later an **unregistered 32 GB USB
mass-storage device** (serial `60A44C4128AF`) was attached to that host, a class that
policy blocks on the finance subnet. At 08:07:22 `robocopy.exe` was launched with a
command line naming both a local staging folder and the removable volume as
destination. At 08:10:08 the endpoint data-protection agent logged **200 files and
2.4 GB copied from `\\fileserver\Finance\Q3`**, 41 of them restricted. The device was
removed at 08:12:14 after 7 minutes 45 seconds, and the session closed at 08:14:36.

Everything you are given — three alerts, the event stream, the account and device
record, the estate's removable-media baseline — is in `new.scenario`. Nothing in this
folder names a technique, an indicator or a responsible host until you have earned it
from the evidence.

**The bulk of the story is not in the event log.** Windows records that the device was
attached and that it was removed; it does not record file copies at all. The 200-file
burst exists only in the data-protection agent log, so an investigation that reads
Windows logs alone sees a plug-in and a plug-out and nothing in between — and one of
the two questions that matters is about the 2.4 GB *staging copy that is still on the
workstation* after the device has already left.

---

## How the case works

| Stage | Name | What you do | XP |
|---|---|---|---|
| — | Briefing | Read the mission, press BEGIN | — |
| 01 | **Detect** | Open all five evidence items | 10 |
| 02 | **Collect** | Tag 26 log lines SIGNAL / CONTEXT / NOISE | 10 |
| 03 | **Correlate** | Order the timeline, name the pattern | 10 |
| 04 | **Connect** | Draw the threads on the pinboard | 10 |
| 05 | **Analyze** | Behaviour, device records, ATT&CK, classify IoCs | 42 |
| 06 | **Report** | Scope, findings, justification, confidence, response | 18 |

Then a debrief sheet: rank, XP ledger, preserved indicators, and your analyst journal.

**Analyst Assist** offers three levels of help and never blocks you. A wrong answer
lowers your score and rank; it never blocks progress, and any section can be
re-answered with **TRY AGAIN**. `RESET CASEFILE` clears saved progress.

---

## Answer order

The order of every question's options is decided at load time from the case seed
(`seed: 115`), not by whoever typed the question — see `shuffleCase()` in `app.js`.

- **Deterministic.** The same case always produces the same order, so reloading
  mid-question never moves an answer under your cursor, and refreshing does not
  reshuffle anything to your advantage.
- **Independent per question.** A different permutation for each question, so no
  slot is worth guessing and clicking the top option ten times scores almost
  nothing. The indicator chips are shuffled for the same reason: the two actionable
  ones are not always the first two.

Grading is by option id throughout, so the shuffle cannot change what is correct —
only where the correct answer sits on screen.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | the whole page: briefing, generic stage host, evidence modal, debrief sheet |
| `style.css` | the paper-and-stamp design system, print styles, reduced-motion support |
| `app.js` | the engine — six stages, scoring, XP ledger, save/resume, accessibility, option shuffling |
| `board.js` | the correlation board — draggable cards, drawn threads, keyboard support |
| `scenarios/beginner-usb-data-copy-001.js` | the case: evidence, log stream, timeline, board, questions, IoCs, ranking |
| `new.scenario` | the JSON brief this case was built from — the source of truth for content |

The engine contains no facts about this case. Headings, ledger lines, the trail card
and the report preview all come from the scenario file's `engine` block, so a
different scenario is a different data file, not a different engine.

---

## Accessibility notes

- The whole game is playable with the keyboard alone. Tab to a board card and press
  Enter or Space to arm it, Tab to the second card and press Enter to choose a
  relation, then Enter on the verb. Escape cancels a pending thread.
- Focus is trapped inside the evidence modal and the debrief sheet, and returns to
  the element that opened them.
- `prefers-reduced-motion` is respected.
- There is a `@media print` block — the debrief sheet prints as a clean intelligence
  product.

## Browser support

Any current evergreen browser. Uses `localStorage`, Pointer Events, CSS custom
properties and `Element.closest`. Degrades to "plays without saving" if
`localStorage` is unavailable (private mode).