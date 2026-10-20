# Pull requests

The repository's GitHub pull requests in a tile: the list, each one's conversation, its diff (drawn
by the app's own diff view) and its checks. Comment, approve, request changes or squash-merge.

It runs `gh` in the tile's repository, as you, so `gh auth login` first.

```bash
hive plugins install @dip497/github-prs
hive plugins enable @dip497/github-prs
hive plugins set @dip497/github-prs state all   # which PRs to list: open, closed, merged, all
hive ctl open-tool @dip497/github-prs/prs
```

Or open **Pull requests** from a frame's **Add** menu. It remembers which pull request was open.

It asks for no permissions. It needs `gh`, and what it does on GitHub it does as you.
