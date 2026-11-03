# Container restart

- Attempt 1 of h4-team-mo-r3 was killed by a container restart (an infrastructure failure, not a crash of the run).
- Started: 2026-11-03T01:35:22.532Z (session 3ba7ce11-a3c6-46a8-a9b5-5466cfb0e720).
- Killed: about 2026-11-03T01:43Z (raw.json last written 01:43:06Z; the machine was up again at about 01:43:10Z).
- No run.json was written; the harness never classified this attempt's end. Its results, transcripts and run folder are kept.
- Cost from its transcripts: about $2.73 (a lower bound: output tokens may be under-counted).
- Ruling (user, 2026-11-02): a machine or container restart is an infrastructure failure, so the run in progress runs again.
  The write-up lists it as a rerun with the reason "container restart" and its time. Not a capped rerun.
