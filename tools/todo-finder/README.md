# TODO finder

Every TODO, FIXME, HACK and XXX note in the repository, grouped by file and counted by marker. Click
one to open its file in the editor beside the tile; "Hand to an agent" starts one in the tile's
frame to deal with it (you read the prompt before it is sent).

It uses `git grep`, so files git ignores stay out.

```bash
hive plugins install @dip497/todo-finder
hive plugins enable @dip497/todo-finder
hive plugins set @dip497/todo-finder pattern "TODO|FIXME|BUG"
```

It asks for two permissions: start agents (`workspace:spawn`) and tell an agent something
(`workspace:prompt`), for "Hand to an agent". It needs `git`.
