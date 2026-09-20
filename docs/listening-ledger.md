# Lori listening ledger v1

```json
{
  "format": "lori-listening-ledger",
  "version": 1,
  "entries": [
    {
      "id": "3943e61e-fb53-4cf3-a813-9782b4b11494",
      "songMd5": "900150983cd24fb0d6963f7d28e17f72",
      "fileName": "example.wav",
      "title": "Example",
      "artist": "Artist",
      "start": 1789862400000,
      "end": 1789862401000
    }
  ]
}
```

`start` and `end` are UTC milliseconds: `[start, end)`, with `0 < end - start <= 60000`. Durations are milliseconds, not the difference between seek-bar positions. `songMd5` is the lowercase MD5 of the complete original audio file, before decoding. Names and tags never identify a song. The example hash is illustrative, not an audio fixture.

A generated record has a random UUID. Its start, identity, and labels are immutable. While playing, the end can grow up to the one-minute boundary; a new record then begins. Pausing, seeking, buffering, rate changes, and track changes end the current contiguous segment. No unfinished record is extrapolated after restart.

To merge two checkpoints of the same ID, all immutable fields must match and the larger end wins. This operation is associative, commutative, and idempotent. Conflicting IDs abort the whole import. Distinct IDs remain distinct ledger evidence, including overlapping device records. Summary calculations union their intervals, clip to the selected dates, and split by local midnight. Song summaries group by MD5 before taking the union. Every summary is disposable and reconstructible from the records.

Storage is an IndexedDB object store `segments`, keyed by `id`, with `start` and `[songMd5, start]` indexes. Range scans include a 60-second lookback for records spanning the start boundary. History reads at most 51 matching rows per page (50 visible and one continuation indicator). Imports run in a single read/write transaction. Exports use a consistent read transaction and chunked Blob construction. An in-memory settled-prefix cache is invalidated by historical changes, including changes broadcast from other windows; it is never part of the exported truth.

Import validation checks version, field types, hash format, integer timestamps, interval length, identifier length and characters, and label lengths. No audio content, absolute source paths, or aggregate counters are exported. Filenames and listening timestamps are present.
