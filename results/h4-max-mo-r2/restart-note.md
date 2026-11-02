# Container restart

- Attempt 1 of h4-max-mo-r2 was killed by a container restart (an infrastructure failure, not a crash of the run).
- Started: 2026-11-02T21:41:21.596Z (session 2303f3a9-24c1-4987-97e6-6e137c74d851).
- Killed: about 2026-11-02T22:30Z (raw.json last written 22:30:02Z; the machine was up again at about 22:30:14Z).
- No run.json was written; the harness never classified this attempt's end. Its results, transcripts and run folder are kept.
- Cost from its transcripts: about $13.30 (a lower bound: output tokens may be under-counted).
- Ruling (user, 2026-11-02): a machine or container restart is an infrastructure failure, so the run in progress runs again.
  The write-up lists it as a rerun with the reason "container restart" and its time. Not a capped rerun.
