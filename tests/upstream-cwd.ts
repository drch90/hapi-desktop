// Upstream golden suites resolve their fixtures from the web package cwd.
// Vitest uses isolated fork workers; this never changes the parent cwd.
process.chdir(process.env.HAPI_UPSTREAM_TEST_CWD!)
