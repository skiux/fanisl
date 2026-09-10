# Active plans — one file per seat

Each seat has a file here. It is the answer to "what am I doing next" when a
session opens cold, and the place other seats leave requests that cross an
ownership boundary.

Keep each one short. Format:

```
## Now          what this seat is working on, one item
## Next         the queue, ordered
## Blocked on   waiting for another seat, name it
## Requests in  what other seats have asked of this seat
```

Longer feature plans live in `features/`. Seat files link to them; they are
not a substitute for a seat file.

Move a file's finished items out — into the commit message, or into
`../completed/` if it was a whole project. Do not let these become changelogs.
