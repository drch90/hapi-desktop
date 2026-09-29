import '@testing-library/jest-dom/vitest'

window.matchMedia ??= (media) => ({
  media,
  matches: false,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
})

// Upstream golden suites resolve their fixtures from the web package cwd.
// Vitest uses isolated fork workers; this never changes the parent cwd.
process.chdir(process.env.HAPI_UPSTREAM_TEST_CWD!)
