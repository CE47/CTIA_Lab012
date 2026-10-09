/* CTI Casefile — Scenario definition
 * Pure data. Loaded as a classic script so the app also works from file://
 * (fetch() of JSON would be blocked by CORS on a local disk).
 *
 * Source of truth for content: ../new.scenario (beginner-usb-data-copy-001)
 *
 * Note on answer order: the engine re-orders every question from the case seed
 * (see shuffleCase in app.js), so the order below is only the authoring order.
 * It is deliberately varied anyway — no single-answer question puts the correct
 * option first, and no multi-select question puts the correct options in the
 * leading slots — so the source is safe to read even without the shuffle.
 *
 * One record here is not a Windows event id: the copy burst comes from the
 * endpoint data-protection agent's own log (FILE), which is the only place the
 * 200-file count is written down at all.
 */
(function () {
  window.CTI_SCENARIOS = window.CTI_SCENARIOS || [];

  window.CTI_SCENARIOS.push({
    id: 'beginner-usb-data-copy-001',
    title: 'The Copy That Left the Building',
    difficulty: 'Beginner',
    seed: 115,
    caseRef: 'CASE 012',
    host: 'sec-win-04',
    host_ip: '10.0.4.13',
    log_sources: ['auth', 'network'],

    mission: {
      brief: 'Investigate workstation sec-win-04 and a USB device attached to it.',
      objective: 'Establish what left this host on removable storage, and whether the person carrying it is authorised to carry it.',
      client: 'Internal Security Operations — Tier 1 Escalation Desk'
    },

    narrative:
      'An employee on the corporate network connected a personal USB storage device to their workstation, ' +
      'copied 200 files from a shared folder onto it, and disconnected the device five minutes later. Whether ' +
      'malicious or policy-violating, USB data movement on a corporate host is a high-priority investigation.',

    /* ---------------------------------------------------------------
     * Strings the engine reads from the scenario, so no fact about this
     * case is written into app.js. Every value here comes from new.scenario;
     * the evidence, stream and questions that follow are built on it.
     * --------------------------------------------------------------- */
    engine: {
      /* stage 2 — the record stream banner */
      stream: {
        window: '08:00–08:45',
        files: ['secwin4-events.evtx', 'endpoint-dlp.log']
      },

      /* stage 5 / 6 — section headings and the progress checklist labels */
      sections: {
        behaviour: 'name the behaviour',
        second: 'read the device records',
        trail: 'assemble the sequence',
        attack: 'map it to attack',
        attackAlso: 'supporting techniques',
        iocs: 'keep the intelligence'
      },

      /* stage 1 — the three questions the analyst carries into the data */
      carryQuestions: [
        'Whose device is it, and is it permitted on this network at all?',
        'What exactly was copied, from where, and how long did it take?',
        'What is still on the device — and who is carrying it out of the building?'
      ],

      /* stage 3 — what the cadence of the sequence means */
      cadenceNote:
        'The order is the finding: device attached at 08:04, a command-line copy tool launched at 08:07, a ' +
        '200-file burst at 08:10, the device pulled at 08:12, and the session ended two minutes later. Six ' +
        'minutes and twelve seconds from plugging in to unplugging, with nothing left on the host to find.',

      /* ledger wording, so the analyst journal reads in the case's own terms */
      awards: {
        evidence:
          'Reviewed the full evidence set: three alerts plus device register and data-classification reference data',
        timeline:
          'Identified the pattern: device attached, 200 files copied, device removed and session closed inside six minutes',
        triageContext:
          'Kept the ordinary logon as context rather than evidence \u2014 it names the user, not the copy',
        board:
          'Correlated the full chain: mchen session \u2192 unknown device \u2192 robocopy staging \u2192 200 files ' +
          '\u2192 device removed',
        attack: 'Mapped the outcome to ATT&CK T1052 Exfiltration Over Physical Medium',
        attackAlso:
          'Identified the supporting technique: T1074.001 Local Data Staging \u2014 the staging folder in the ' +
          'robocopy command line',
        host: 'Scoped the incident to host sec-win-04'
      },

      /* stage 5 — the collapsed trail card, and its journal entry */
      trailRows: [
        { k: 'Subject', v: 'mchen', flag: '\u2014 Finance Analyst, USB storage prohibited on this subnet' },
        { k: 'Device', v: 'unknown serial', flag: '\u2014 not on the corporate register, mass storage, 32 GB' },
        { k: 'Copy', v: '200 files', flag: '\u2014 from \\\\fileserver\\Finance\\Q3, which is restricted' },
        { k: 'Trail', v: 'mchen 08:02:11 \u2192 device 08:04:29 \u2192 robocopy 08:07:22 \u2192 200 files 08:10:08 \u2192 removed 08:12:14 \u2192 logoff 08:14:36' }
      ],
      trailLabel: 'REVEAL THE FULL CHAIN',
      journalDecode:
        'Assembled the chain \u2014 device connected 08:04:29, robocopy launched 08:07:22 with a local staging ' +
        'folder, 200 files copied 08:10:08, device removed 08:12:14, logoff 08:14:36',

      /* stage 6 — the live assessment preview */
      reportPreview: {
        rows: [
          { label: 'Host', value: 'sec-win-04 (10.0.4.13)', code: true },
          { label: 'User', value: 'mchen \u2014 USB storage prohibited on the finance subnet', code: true },
          { label: 'Device', value: 'unknown serial, 32 GB mass storage \u2014 never seen on the fleet', code: true },
          { label: 'Copied', value: '200 files from \\\\fileserver\\Finance\\Q3 \u2014 a restricted share', code: true },
          { label: 'Window', value: '08:04:29 to 08:12:14 \u2014 device removed, session closed after', code: true },
          { label: 'TTP', value: 'Exfiltration Over Physical Medium T1052', code: false }
        ],
        note:
          'Assemble your justification in the fields above. The assessment is only defensible if the reasoning ' +
          'is visible.'
      }
    },

    /* ---------------------------------------------------------------
     * STAGE 2 — TRIAGE
     * The student tags each event as signal / context / noise.
     * tags: 'signal' | 'context' | 'noise'
     * --------------------------------------------------------------- */
    events: [
      {
        id: 'ev-4624-mchen',
        ts: '08:02:11',
        code: 4624,
        kind: 'event',
        host: 'sec-win-04',
        actor: 'mchen',
        text: 'Successful logon. Account "mchen". Logon type 2 (interactive). Source 10.0.4.20.',
        tags: 'context',
        why:
          'The session the device work will be attributed to, and nothing more in itself. It matters for one ' +
          'reason: it establishes who had the machine at the time, which is the first question a responder ' +
          'asks \u2014 and the answer here is a person, not an intruder.'
      },
      {
        id: 'ev-6416-device',
        ts: '08:04:29',
        code: 6416,
        kind: 'event',
        host: 'sec-win-04',
        text: 'External device connected. Class: USB mass storage. Vendor/product: Kingston DataTraveler 3.0. Serial 60A44C4128AF. First seen on the corporate fleet.',
        tags: 'signal',
        why:
          'The serial is not on the register, and USB mass storage is prohibited on the finance subnet by ' +
          'policy. A first-seen device is the fact that makes the rest of the hour matter \u2014 if the register ' +
          'already held this serial, the copy might have had a routine answer.'
      },
      {
        id: 'ev-4688-robocopy',
        ts: '08:07:22',
        code: 4688,
        kind: 'event',
        host: 'sec-win-04',
        actor: 'mchen',
        text: 'Process created by mchen: robocopy.exe. Command line: robocopy \\\\fileserver\\Finance\\Q3 C:\\Users\\mchen\\AppData\\Local\\Temp\\stage "USB-STICK (E:)\\" /E /R:1 /W:1.',
        tags: 'signal',
        why:
          'Read the command line rather than the process name. robocopy is a signed Windows utility, so an ' +
          'allow-list of binaries would wave it through \u2014 but it names three things that cannot be ' +
          'innocent: a restricted share, a local staging folder, and a removable volume as the destination.'
      },
      {
        id: 'ev-file-copy',
        ts: '08:10:08',
        code: 'FILE',
        kind: 'event',
        host: 'sec-win-04',
        actor: 'mchen',
        text: 'File copy to removable device: 200 files copied from \\\\fileserver\\Finance\\Q3 to E:\\ between 08:10:08 and 08:10:41, including 41 documents marked restricted. Total 2.4 GB.',
        tags: 'signal',
        why:
          'The count is the finding, and where it lives matters too: the copy is logged by the endpoint ' +
          'data-protection agent, not by Windows, so an investigation that only reads event logs sees the ' +
          'device attach and the disconnect and nothing between them. Forty-one of the 200 files were ' +
          'restricted, which turns a policy question into a data-handling one.'
      },
      {
        id: 'ev-6417-device-removed',
        ts: '08:12:14',
        code: 6417,
        kind: 'event',
        host: 'sec-win-04',
        text: 'External device removed. Serial 60A44C4128AF. Time connected: 08:04:29. Duration: 7m45s.',
        tags: 'signal',
        why:
          'Seven minutes and forty-five seconds attached, then gone. A device that stays in a machine all day ' +
          'and a device that is put in a pocket after one copy are different objects, and only one of them ' +
          'leaves with you.'
      },
      {
        id: 'ev-4634-logoff',
        ts: '08:14:36',
        code: 4634,
        kind: 'event',
        host: 'sec-win-04',
        actor: 'mchen',
        text: 'Logoff. Session closed for account "mchen". Reason: user initiated.',
        tags: 'signal',
        why:
          'Two minutes after the device was pulled, the session ended by user action. Whatever the intention ' +
          'was, the shape of the ending \u2014 copy, unplug, log off \u2014 is the shape of leaving, and it is ' +
          'the reason this is a priority rather than a reminder to someone.'
      },

      /* ---------- noise: baseline user activity ---------- */
      { id: 'ev-n01', ts: '08:00:36', code: 4624, kind: 'event', host: 'FIN-WS-14', actor: 'jdoe', text: 'Successful logon. Logon type 2. Source 10.0.4.10.', tags: 'noise' },
      { id: 'ev-n02', ts: '08:02:06', code: 4634, kind: 'event', host: 'FIN-WS-14', actor: 'jdoe', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n03', ts: '08:02:55', code: 4672, kind: 'event', host: 'HR-LT-03', actor: 'asmith', text: 'Special privileges assigned to new logon.', tags: 'noise' },
      { id: 'ev-n04', ts: '08:03:41', code: 4624, kind: 'event', host: 'OPS-WS-09', actor: 'kpatel', text: 'Successful logon. Logon type 2. Source 10.0.4.10.', tags: 'noise' },
      { id: 'ev-n05', ts: '08:05:14', code: 4634, kind: 'event', host: 'FIN-WS-14', actor: 'jdoe', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n06', ts: '08:05:38', code: 4624, kind: 'event', host: 'ENG-WS-02', actor: 'rneuman', text: 'Successful logon. Logon type 2. Source 10.0.4.21.', tags: 'noise' },
      { id: 'ev-n07', ts: '08:06:44', code: 4634, kind: 'event', host: 'HR-LT-03', actor: 'asmith', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n08', ts: '08:07:57', code: 4672, kind: 'event', host: 'OPS-WS-09', actor: 'kpatel', text: 'Special privileges assigned to new logon.', tags: 'noise' },
      { id: 'ev-n09', ts: '08:08:19', code: 4624, kind: 'event', host: 'FIN-LT-11', actor: 'svega', text: 'Successful logon. Logon type 2. Source 10.0.4.11.', tags: 'noise' },
      { id: 'ev-n10', ts: '08:09:24', code: 4634, kind: 'event', host: 'OPS-WS-09', actor: 'kpatel', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n11', ts: '08:10:37', code: 4672, kind: 'event', host: 'HR-LT-03', actor: 'svega', text: 'Special privileges assigned to new logon.', tags: 'noise' },
      { id: 'ev-n12', ts: '08:11:44', code: 4624, kind: 'event', host: 'ENG-WS-02', actor: 'jdoe', text: 'Successful logon. Logon type 2. Source 10.0.4.21.', tags: 'noise' },
      { id: 'ev-n13', ts: '08:12:49', code: 4634, kind: 'event', host: 'FIN-LT-11', actor: 'svega', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n14', ts: '08:14:21', code: 4624, kind: 'event', host: 'HR-LT-03', actor: 'rneuman', text: 'Successful logon. Logon type 2. Source 10.0.4.11.', tags: 'noise' },
      { id: 'ev-n15', ts: '08:16:29', code: 4634, kind: 'event', host: 'ENG-WS-02', actor: 'jdoe', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n16', ts: '08:17:07', code: 4672, kind: 'event', host: 'FIN-WS-14', actor: 'kpatel', text: 'Special privileges assigned to new logon.', tags: 'noise' },
      { id: 'ev-n17', ts: '08:19:23', code: 4624, kind: 'event', host: 'SALES-LT-11', actor: 'asmith', text: 'Successful logon. Logon type 2. Source 10.0.4.10.', tags: 'noise' },
      { id: 'ev-n18', ts: '08:21:39', code: 4634, kind: 'event', host: 'SALES-LT-11', actor: 'kpatel', text: 'Logoff. Session closed.', tags: 'noise' },
      { id: 'ev-n19', ts: '08:24:03', code: 4624, kind: 'event', host: 'FIN-LT-11', actor: 'rneuman', text: 'Successful logon. Logon type 2. Source 10.0.4.21.', tags: 'noise' },
      { id: 'ev-n20', ts: '08:26:16', code: 4672, kind: 'event', host: 'HR-LT-03', actor: 'asmith', text: 'Special privileges assigned to new logon.', tags: 'noise' }
    ],

    /* ---------------------------------------------------------------
     * STAGE 1 — EVIDENCE INBOX
     * --------------------------------------------------------------- */
    evidence: [
      {
        id: 'al-6416-device',
        ref: 'ALERT-01',
        severity: 'medium',
        title: 'USB mass storage device connected',
        blurb: 'An external USB mass storage device was recognised on sec-win-04 (Event 6416). This device has not been seen on the corporate fleet before.',
        detail:
          'DeviceSetupManager Event 6416 \u2014 "Device was installed" \u2014 class USB mass storage, Kingston ' +
          'DataTraveler 3.0, serial 60A44C4128AF, at 08:04:29. The register of approved peripherals holds ' +
          '1,409 devices estate-wide and this serial is not among them; removable storage is additionally ' +
          'blocked by policy on the finance subnet, so this attachment is the exception the policy exists to ' +
          'catch.',
        hint: 'Ask: is this device on the register, and is its class permitted where it was plugged in?'
      },
      {
        id: 'al-200-files',
        ref: 'ALERT-02',
        severity: 'high',
        title: 'Large file copy to USB device',
        blurb: '200 files were copied to the removable device on sec-win-04 within 5 minutes of connection.',
        detail:
          'Endpoint data-protection log \u2014 200 files, 2.4 GB, from \\\\fileserver\\Finance\\Q3 to E:\\ ' +
          'between 08:10:08 and 08:10:41, of which 41 carry the restricted classification. The source share is ' +
          'one finance staff read access that; the destination is a device with no encryption policy, no ' +
          'corporate label and no register entry. This record exists only in the DLP agent log \u2014 Windows ' +
          'does not log file copies.',
        hint: 'Ask: what was copied, from where, and what does the device on the other end do with it?'
      },
      {
        id: 'al-quick-remove',
        ref: 'ALERT-03',
        severity: 'high',
        title: 'USB device disconnected immediately after copy',
        blurb: 'The device was disconnected within 5 minutes of the file copy burst, consistent with a targeted exfiltration action.',
        detail:
          'Event 6417 \u2014 device removed at 08:12:14, connected 08:04:29, attached for 7 minutes 45 ' +
          'seconds. The session on the workstation then closed at 08:14:36 by user action. Copy, unplug, log ' +
          'off: the ordering is the reason this is filed as a priority rather than as a policy reminder, ' +
          'because the data is no longer on the estate.',
        hint: 'Ask: how long was it attached, and what happened on the workstation afterwards?'
      },
      {
        id: 'ev-user',
        ref: 'EVID-04',
        severity: 'info',
        title: 'User and device record — mchen',
        blurb: 'Directory record for the account at the workstation when the device was attached.',
        detail:
          'mchen \u2014 M. Chen, Finance Analyst, 27 months in post, group membership Domain Users and ' +
          'Finance-Read. Member of the corporate laptop programme with a managed device; no removable-media ' +
          'exemption is recorded against the account, and finance subnet policy has blocked USB mass storage ' +
          'since 08:00 on that day. Intermittent connectivity from 07:40, consistent with working from home.',
        hint: 'Ask: is there any exemption on this account, and is there a reason to be working off-site?'
      },
      {
        id: 'ev-baseline',
        ref: 'EVID-05',
        severity: 'info',
        title: 'Baseline activity — removable media across the estate',
        blurb: 'Reference records for device attachment and copy volume in the same window.',
        detail:
          'In this hour 41 removable devices were attached estate-wide: 38 encrypted corporate dongles, all ' +
          'registered, and 3 whose class policy permits them. No registered device was used to copy more than ' +
          '6 files. Across the last 30 days, no user has copied more than 40 files to removable media on any ' +
          'host \u2014 and nobody has ever copied from a share marked restricted. Five baseline users ' +
          'generated 20 logon, logoff and privilege events across FIN-WS-14, HR-LT-03, ENG-WS-02, OPS-WS-09, ' +
          'FIN-LT-11 and SALES-LT-11.',
        hint: 'Ask: is this device and this volume unusual for the estate, or only for this host?'
      }
    ],

    alerts: [
      { name: 'USB mass storage device connected', severity: 'medium' },
      { name: 'Large file copy to USB device', severity: 'high' },
      { name: 'USB device disconnected immediately after copy', severity: 'high' }
    ],

    /* ---------------------------------------------------------------
     * STAGE 3 — TIMELINE
     * --------------------------------------------------------------- */
    timeline: [
      { t: 'T+0', ts: '08:02:11', label: 'Logon', detail: 'successful_logon (4624): mchen interactive on sec-win-04 from 10.0.4.20', net: null },
      { t: 'T+2', ts: '08:04:29', label: 'Device', detail: 'external_device_connected (6416): unknown USB mass storage, serial 60A44C4128AF, on sec-win-04', net: null },
      { t: 'T+5', ts: '08:07:22', label: 'Process', detail: 'process_created (4688): robocopy.exe by mchen \u2014 \\\\fileserver\\Finance\\Q3 \u2192 local staging \u2192 E:\\', net: null },
      { t: 'T+8', ts: '08:10:08', label: 'Copy', detail: 'file_copy: 200 files, 2.4 GB, from \\\\fileserver\\Finance\\Q3 to the device, 41 of them restricted', net: null },
      { t: 'T+10', ts: '08:12:14', label: 'Device', detail: 'external_device_disconnected (6417): serial 60A44C4128AF after 7m45s attached', net: null },
      { t: 'T+12', ts: '08:14:36', label: 'Logoff', detail: 'user_logoff (4634): mchen session closed by user action', net: null }
    ],

    timelineQuestion: {
      id: 'q-timeline',
      prompt: 'What pattern do you see in this sequence?',
      options: [
        { id: 'a', label: 'A user backing up personal files onto a personal drive before working from home' },
        { id: 'b', label: 'An endpoint agent installing a signed storage driver that briefly listed a device' },
        { id: 'c', label: 'A device attached, a bulk copy made from a restricted share to a local folder and then to the device, and the device taken away' },
        { id: 'd', label: 'A scheduled file transfer that finished early and logged the user off' }
      ],
      correct: ['c'],
      xp: 10,
      explain:
        'Each alternative needs something the records contradict. A personal backup does not start from a ' +
        'restricted share or pull 200 files in 33 seconds; a driver installation does not open robocopy with a ' +
        'staging folder and a removable destination; and a scheduled transfer neither chooses its own source ' +
        'share nor leave with the device. What the sequence shows is assembly and removal \u2014 and the 7 ' +
        'minutes 45 seconds attached is the part a reminder could not have prevented.'
    },

    /* ---------------------------------------------------------------
     * STAGE 4 — CORRELATION BOARD
     * --------------------------------------------------------------- */
    boardNodes: [
      { id: 'n-session', label: 'mchen session', sub: 'from 10.0.4.20', x: 8, y: 8 },
      { id: 'n-device', label: 'USB mass storage', sub: 'unknown serial, 32 GB', x: 8, y: 62 },
      { id: 'n-robocopy', label: 'robocopy.exe', sub: 'with a local staging folder', x: 40, y: 36 },
      { id: 'n-burst', label: '200 files copied', sub: 'from \\\\fileserver\\Finance\\Q3', x: 40, y: 82 },
      { id: 'n-gone', label: 'device removed', sub: '5 minutes later', x: 72, y: 36 }
    ],
    boardLinks: [
      { from: 'n-session', to: 'n-device', label: 'connects', correct: true },
      { from: 'n-session', to: 'n-robocopy', label: 'launches', correct: true },
      { from: 'n-robocopy', to: 'n-burst', label: 'produces', correct: true },
      { from: 'n-device', to: 'n-burst', label: 'holds', correct: true },
      { from: 'n-device', to: 'n-gone', label: 'closes', correct: true },
      { from: 'n-gone', to: 'n-burst', label: 'restores', correct: false },
      { from: 'n-robocopy', to: 'n-device', label: 'creates', correct: false }
    ],
    boardXp: 10,

    /* ---------------------------------------------------------------
     * STAGE 5 — ANALYSIS: behaviour, ATT&CK, IoCs
     * --------------------------------------------------------------- */
    behaviourQuestions: [
      {
        id: 'q-persist',
        prompt: 'How would you classify 200 files copied from a restricted share onto a personal USB device?',
        options: [
          { id: 'a', label: 'Impact \u2014 the restricted documents are no longer controlled' },
          { id: 'b', label: 'Collection \u2014 the files were gathered somewhere before being moved' },
          { id: 'c', label: 'Exfiltration \u2014 data left the estate on a medium nobody monitors' },
          { id: 'd', label: 'Lateral movement \u2014 the copy reached other hosts on the network' }
        ],
        correct: ['c'],
        xp: 10,
        explain:
          'The data physically left the estate on a medium with no controls, no encryption policy and no ' +
          'inventory \u2014 which is the definition of exfiltration, and it is why this is filed as an incident ' +
          'rather than a policy reminder. Collection is the step inside it (the staging folder), and impact is ' +
          'a consequence rather than the behaviour; nothing moved between hosts, so lateral movement is out.'
      },
      {
        id: 'q-ps',
        prompt: 'Why does it matter that the copy went through a local staging folder first?',
        options: [
          { id: 'a', label: 'It does not \u2014 the end result is the same either way' },
          { id: 'b', label: 'It leaves a copy of the restricted data on the workstation after the device is removed' },
          { id: 'c', label: 'It slows the copy down, which is why the transfer took 33 seconds' },
          { id: 'd', label: 'It means the files were first encrypted before being written to the device' }
        ],
        correct: ['b'],
        xp: 10,
        explain:
          'Pulling the share into a staging folder and pushing it out writes the data twice, and the first copy ' +
          'stays on the workstation. That is why "we took the device away" is not a remedy: the restricted ' +
          'documents remain on sec-win-04 until somebody looks for them, which is a different and larger ' +
          'remediation than the device itself.'
      }
    ],

    decodedCommand: {
      encoded: 'mchen 08:02:11 \u2192 device 08:04:29 \u2192 robocopy 08:07:22 \u2192 200 files 08:10:08 \u2192 removed 08:12:14 \u2192 logoff 08:14:36',
      decoded: 'interactive session (4624) \u2192 unknown removable device attached (6416) \u2192 signed copy utility with a staging folder (4688) \u2194 200 files to the device (DLP log) \u2192 device removed (6417) \u2192 session closed (4634)',
      note:
        'Six records from three different sources, and only one of them would appear if you read event logs: ' +
        'the device attach, the copy and the removal are there, but the 200-file burst itself lives in the ' +
        'data-protection agent log, because Windows does not record file copies at all.'
    },

    attack: {
      /* the engine renders primary.prompt and alsoPresent.prompt as the question text */
      primary: {
        prompt: 'Which technique best explains how the data left the estate?',
        options: [
          { id: 'a', label: 'Exfiltration Over C2 Channel', meta: 'T1041 \u00b7 Exfiltration' },
          { id: 'b', label: 'Archive Collected Data: Archive via Custom Method', meta: 'T1560.003 \u00b7 Collection' },
          { id: 'c', label: 'Exfiltration Over Physical Medium', meta: 'T1052 \u00b7 Exfiltration' },
          { id: 'd', label: 'Data from Local System', meta: 'T1005 \u00b7 Collection' }
        ],
        correct: ['c'],
        xp: 10,
        explain:
          'The data left on something you can hold \u2014 which is precisely Exfiltration Over Physical Medium, ' +
          'T1052. It is worth distinguishing from the others because each one implies a different control: ' +
          'there is no C2 channel here to monitor (option A), nothing was compressed or bundled for later ' +
          'retrieval (B), and T1005 describes reading local system data rather than carrying it off the site.'
      },
      alsoPresent: {
        prompt: 'One further technique is genuinely present. Select it.',
        options: [
          { id: 'a', label: 'Data from Local System', meta: 'T1005 \u00b7 Collection' },
          { id: 'b', label: 'Local Data Staging', meta: 'T1074.001 \u00b7 Collection' },
          { id: 'c', label: 'Exfiltration Over Alternative Protocol', meta: 'T1048 \u00b7 Exfiltration' },
          { id: 'd', label: 'Masquerading: Match Legitimate Name or Location', meta: 'T1036.005 \u00b7 Defense Evasion' }
        ],
        correct: ['b'],
        xp: 10,
        explain:
          'The robocopy command line names the staging folder explicitly: the restricted share is pulled into ' +
          'C:\\Users\\mchen\\AppData\\Local\\Temp\\stage first, and the device is written from there. Gathering ' +
          'data in one place before moving it is Local Data Staging, T1074.001 \u2014 and it is why 2.4 GB ' +
          'still sits on sec-win-04 after the device is gone. Option D is a near-miss that is not supported by ' +
          'anything here: the file paths in the command line are the user\u2019s own, not another system\u2019s.'
      }
    },

    iocs: {
      prompt: 'Which of these would you preserve as indicators or investigative pivots?',
      options: [
        { id: 'i1', label: 'device serial 60A44C4128AF', role: 'indicator' },
        { id: 'i2', label: '\\\\fileserver\\Finance\\Q3 copied to removable media', role: 'indicator' },
        { id: 'i3', label: 'sec-win-04', role: 'context' },
        { id: 'i4', label: 'mchen', role: 'context' },
        { id: 'i5', label: 'Event 6416', role: 'context' },
        { id: 'i6', label: 'a removable device attached for under ten minutes and removed', role: 'behaviour' },
        { id: 'i7', label: 'bulk copies from a restricted share', role: 'behaviour' },
        { id: 'i8', label: 'a copy utility launched with a staging folder and a removable destination', role: 'behaviour' }
      ],
      correct: ['indicator', 'behaviour', 'context'],
      xp: 10,
      explain:
        'Two of these eight are things you act on today: the device serial, which is the one identifier that ' +
        'follows the data out of the building and is worth a watch-list entry, and the source-plus-destination ' +
        'pair, which is a precise hunt for the same act elsewhere. The behaviours are the detections worth ' +
        'engineering: short attachment windows, bulk copies from restricted shares, and a copy utility invoked ' +
        'with both a staging folder and a removable target \u2014 which catches the act whatever the binary is ' +
        'called. sec-win-04, mchen and Event 6416 are context.'
    },

    /* ---------------------------------------------------------------
     * STAGE 6 — REPORT
     * --------------------------------------------------------------- */
    report: {
      host: {
        prompt: 'Which host is affected?',
        options: [
          { id: 'a', label: 'FIN-LT-11' },
          { id: 'b', label: 'OPS-WS-09' },
          { id: 'c', label: '10.0.4.21' },
          { id: 'd', label: 'sec-win-04' }
        ],
        correct: ['d'],
        xp: 10,
        explain:
          'Every relevant record is on sec-win-04, from the mchen logon to the removal of the device. ' +
          '10.0.4.21 is an address used elsewhere in this estate and names no host here.'
      },
      what: {
        prompt: 'What happened?',
        options: [
          { id: 'a', label: 'A user copied personal working files to a personal drive before working from home, breaking a rule they did not know applied.' },
          { id: 'b', label: 'An endpoint agent briefly listed an attached storage driver while installing an update.' },
          { id: 'c', label: 'A scheduled transfer copied a restricted folder to removable media as part of a backup job.' },
          { id: 'd', label: 'On sec-win-04, mchen attached an unregistered 32 GB USB device at 08:04:29, ran robocopy at 08:07:22 to pull \\\\fileserver\\Finance\\Q3 into a local staging folder and then onto the device, copied 200 files (2.4 GB, 41 restricted), removed the device at 08:12:14 and logged off at 08:14:36.' }
        ],
        correct: ['d'],
        xp: 10,
        explain:
          'The assessment has to carry the device, the user, the source, the volume and the classification of ' +
          'what left \u2014 those are the five facts a response is built on, and each one rules out a different ' +
          'benign story. "A user copied files to a USB drive" fits all four options above; naming the restricted ' +
          'share and the 41 restricted documents does not.'
      },
      why: {
        prompt: 'Why is it suspicious? Select every reason that holds.',
        options: [
          { id: 'a', label: 'The device is not on the peripheral register, and USB mass storage is blocked by policy on the finance subnet' },
          { id: 'b', label: '200 files and 2.4 GB were copied in 33 seconds \u2014 more than any user has copied to removable media in 30 days' },
          { id: 'c', label: '41 of the files were marked restricted, and nobody has ever copied that share to removable media' },
          { id: 'd', label: 'mchen has no removable-media exemption on record' },
          { id: 'e', label: 'The device was attached for 7 minutes 45 seconds and removed immediately after the copy' },
          { id: 'f', label: 'Working from home is common on this team, so copying files locally is expected' }
        ],
        correct: ['a', 'b', 'c', 'd', 'e'],
        xp: 10,
        explain:
          'Five of these six are anchored to a record or a fact you were given: an unregistered device in a ' +
          'prohibited class, a rate nobody has exceeded, a restricted classification with no precedent, an absent ' +
          'exemption and a seven-minute attachment ending right after the burst. Only option F is an assumption ' +
          '\u2014 and it is the one that would turn an incident into a note in a folder. The baseline records 41 ' +
          'removable devices attached in this same hour, and not one of them behaved like this.'
      },
      confidence: {
        prompt: 'Analyst confidence in this assessment',
        options: [
          { id: 'a', label: 'Low' },
          { id: 'b', label: 'Medium' },
          { id: 'c', label: 'High' }
        ],
        correct: ['c'],
        xp: 10,
        explain:
          'The device log, the DLP record, the policy state and the estate baseline all agree, and they agree ' +
          'on the sequence as well as the facts. The genuinely open question is intent \u2014 whether this was ' +
          'deliberate theft, negligence, or something in between \u2014 and that is settled by talking to mchen, ' +
          'not by another log line. It does not lower confidence in what happened.'
      },
      actions: {
        prompt: 'Recommended next actions. Select the three that follow from this assessment.',
        options: [
          { id: 'a', label: 'Block the device serial estate-wide, and identify every host it has been attached to' },
          { id: 'b', label: 'Establish what is still on sec-win-04 \u2014 the 2.4 GB staging copy, not only the device that left' },
          { id: 'c', label: 'Interview mchen and review what the 41 restricted documents were, before deciding whether this is a disciplinary or a data-handling matter' },
          { id: 'd', label: 'Rebuild sec-win-04 and disable removable storage across the whole estate immediately' },
          { id: 'e', label: 'Enforce encrypted removable media only, and block mass-storage class at the endpoint' },
          { id: 'f', label: 'Widen the approved peripheral register so personal devices stop generating alerts' }
        ],
        correct: ['a', 'b', 'c'],
        xp: 10,
        explain:
          'Follow the data first: block the serial and find every host it has touched, because the device is the ' +
          'one artifact that left the building. Then look at what stayed \u2014 the staging copy is still on ' +
          'sec-win-04, and "we took the device back" does not address it. And establish intent with the person ' +
          'before deciding what kind of case this is; 200 files and a restricted share read very differently ' +
          'once you know whether they were theirs. Options E and F are policy changes that follow the ' +
          'investigation, and option D would destroy the staging evidence before anybody has looked at it.'
      }
    },

    reasoning: {
      prompt: 'Which three pieces of evidence most strongly support your assessment? Select exactly three.',
      options: [
        { id: 'r1', label: 'mchen is a member of Domain Users and Finance-Read', key: false },
        { id: 'r2', label: 'Event 6416: an unregistered 32 GB USB mass storage device, serial 60A44C4128AF, attached to sec-win-04 at 08:04:29 on a subnet where that class is prohibited', key: true },
        { id: 'r3', label: 'Four other users were active on the estate during the same hour', key: false },
        { id: 'r4', label: 'Endpoint DLP log: 200 files and 2.4 GB copied from \\\\fileserver\\Finance\\Q3 to the device in 33 seconds, 41 of them restricted', key: true },
        { id: 'r5', label: 'Event 4672 appears on this host several times a day', key: false },
        { id: 'r6', label: 'Event 4688: robocopy.exe launched with a local staging folder and the removable volume as destination, and Event 6417: the device removed after 7m45s', key: true },
        { id: 'r7', label: 'The workstation has the standard corporate build', key: false }
      ],
      correctCount: 3,
      xp: 10,
      explain:
        'These three come from three different sources \u2014 the device log, the DLP agent and the event log ' +
        '\u2014 and between them they establish that the device was not permitted, what it carried and how it ' +
        'got the data, which is the minimum a finding like this needs. Group membership in isolation, estate ' +
        'busyness, routine privilege events and the software build describe the background: true, and not ' +
        'load-bearing.'
    },

    /* mirrored verbatim from new.scenario — the dotted keys are kept as written
       there, because this block is the record of what the case is actually made of */
    ground_truth: {
      external_devices_connected: 1,
      file_copy_events_to_usb: 1,
      files_copied_to_usb: 200,
      target_host: 'sec-win-04',
      user_responsible: 'mchen',
      event_ids_present: [4624, 4634, 4688, 6416]
    },

    ranking: [
      { min: 90, rank: 'Lead Intelligence Analyst', note: 'You produced defensible intelligence, not just correct answers.' },
      { min: 75, rank: 'Threat Intelligence Analyst', note: 'Strong correlation and a defensible judgment.' },
      { min: 55, rank: 'Junior CTI Investigator', note: 'You found the copy and explained it. Tighten the correlation and the reporting.' },
      { min: 0, rank: 'Case Officer Trainee', note: 'Re-run the case. Start with the device serial, then ask what went onto it.' }
    ],

    assist: {
      nudge: { label: 'Nudge', mult: 0.85, text: 'Ignore that a copy happened and look at where the data went and how long the device stayed attached.' },
      hint: { label: 'Analyst Hint', mult: 0.7, text: 'One record says the device was not permitted. One says what left and how much. One says what remains on the workstation.' },
      explain: { label: 'Explain', mult: 0.5, text: 'On sec-win-04, mchen attached an unregistered 32 GB USB mass-storage device, serial 60A44C4128AF, at 08:04:29 \u2014 a class blocked by policy on the finance subnet. At 08:07:22 robocopy.exe was launched with the command line robocopy \\\\fileserver\\Finance\\Q3 C:\\Users\\mchen\\AppData\\Local\\Temp\\stage "USB-STICK (E:)\\" /E, pulling a restricted share into a local staging folder before writing to the device. The DLP agent logged 200 files and 2.4 GB, 41 of them restricted, copied in 33 seconds. The device was removed at 08:12:14 after 7m45s and the session closed at 08:14:36. The outcome is Exfiltration Over Physical Medium, T1052, with Local Data Staging, T1074.001, behind it. Block the serial, find the 2.4 GB still staged on the workstation, and establish intent with mchen.' }
    }
  });
})();