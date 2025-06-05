# Time Spent on Zani

A report of time spent working on ZaniJS, by week. This only tracks coding time, and does not track time taken
to design architecture, research problems/solutions, or run lengthy tests.

### Prior to May 25, 2025
Time was not tracked, but is estimated to be roughly 50 hours, assuming 2 hours per commit of 24 commits, plus 2 hours just for rounded number.

**Accomplished**
- System foundation
- JSONL (1 entry per line) persistence
- Logging, metadata, and crash detection
- Full per query line, for each entry query engine.


### 25-31 May, 2025
Total Time: 22 hours, 50 minutes
Average: 3 hours, 50 minutes
Active: 6 days

**Accomplished**
- Implementation of Indexing (insertion, updates, deletion, createIndex function, depth-limit of 2)
- Redesigned data persistence structure to be 1 entry per json rather than jsonl based
- Added updateEntry method, added input validation to addEntry
- Added semaphore to ensure file limit cannot be reached
- Built query outline, including deconstruction of query into indexed and non-indexed parts
- Added all non-indexed query methods (For each entry, run entire query)

### 1-7 June, 2025
Total Time: 
Average: 
Active: 

**Accomplished**
- Added all indexed query methods (For each query criteria, search indexed values for appropriate entries)
- Switch to storing ID during query rather than method to reduce memory footprint
- Added all logical query methods ($and, $or, etc)
- Added projection, sorting, and smart indexing functionality, effectively completing query engine