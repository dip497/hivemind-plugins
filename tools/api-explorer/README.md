# API explorer

The HTTP endpoints your code declares, found with `git grep` and grouped by path, each method in
its colour with the file and line that declares it (click to open the file). Search by path, method
or file. Choose a method to load it into "Try it", which sends the request to your running server
and shows the status, the time it took, the headers and the body (JSON laid out to read).

It reads FastAPI and Flask (`@app.get("/x")`, `@router.post(...)`, `@app.route("/x",
methods=[...])`), Express, Hono and Fastify (`app.get('/x', …)`, `router.delete(...)`), Go's
`HandleFunc("GET /x", …)`, gin and echo (`r.POST("/x", …)`), and axum
(`.route("/x", get(a).post(b))`). Routes in test files and comments, and calls made with a client
such as `axios.get('/x')`, are left out.

```bash
hive tools install dip497/api-explorer
hive plugins enable tool:dip497/api-explorer
hive plugins set tool:dip497/api-explorer baseUrl http://127.0.0.1:3000
hive ctl open-tool dip497/api-explorer/explorer
```

An agent drives it, while its tile is open:

```bash
hive ctl plugin call dip497/api-explorer endpoints
hive ctl plugin call dip497/api-explorer request '{"method":"POST","path":"/items","body":{"name":"lamp"}}'
```

An agent's GET to an endpoint found in the code is sent at once. Anything else an agent asks for
(a POST, PUT, PATCH or DELETE, or a path the code does not declare) waits in the tile, saying
what it would send and why it asks, until you press **Send it** or **Refuse**; unanswered after five
minutes, it is not sent. Requests only ever go to the base address.

Requests go through `curl` (`-s -i -g -X <method> --max-time 10`), with a body sent as JSON on
stdin. It asks for no permissions.

## How it was made

Built by a coding agent (Claude) from the tool-plugin contract (the brief
`hive tools new` writes, and the tool plugin guide). It uses `host.run` of `git grep` and `curl`,
`host.openFile` for a declaring file, and `useTileState` for the search and the chosen endpoint.
Finding routes and reading a response are in `lib.js`, tested on real route lines and on `git grep`
in a scratch repository.
