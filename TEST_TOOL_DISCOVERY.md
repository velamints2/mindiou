# Even G2 Preflight Tool Discovery

## Problem

Even Hub developers can compile and package an app while still shipping:

- blank or overfilled G2 frames;
- incorrect zero-value click handling;
- duplicate or spontaneous navigation;
- clipped list items;
- console errors;
- simulator/device behavior mismatches;
- BLE-heavy image update patterns.

Community reports repeatedly describe apps reaching users with basic launch,
lifecycle, and interaction failures. Developers also report difficulty testing
Private/Beta behavior before release.

## Existing Alternatives

- Even Hub Simulator provides rendering, input, screenshots, console capture, and
  an HTTP automation API.
- `even-dev` provides a multi-application simulator environment.
- Project-specific scripts can call the simulator API directly.

Therefore a useful tool cannot be only a simulator launcher.

## Validated Need

There is a credible need for a **pre-release evidence harness** that:

- starts or verifies the app, API, and simulator;
- replays a declared input contract;
- detects blank/overfilled frames from alpha pixels;
- detects no-input state changes and duplicated actions;
- captures before/after screenshots and console output;
- checks container and manifest constraints;
- emits a portable JSON/Markdown report for a release or pull request;
- separates simulator-pass claims from real-device-only checks.

## Recommendation

Keep the tool embedded in Learn Coach until it has prevented at least three
different regressions and another Even Hub developer confirms the workflow is
useful.

If that evidence appears, extract it as an open-source CLI tentatively named
`evenhub-preflight`. Do not position it as a commercial product yet; the current
developer market is small and the official simulator may absorb some features.

## Current Evidence

The local harness has already caught:

1. a framebuffer that looked solid green until alpha-aware inspection;
2. click events that failed because protobuf omitted the zero-valued event type;
3. an unsafe click interpretation that previously caused spontaneous changes;
4. hidden Ask/Repeat gesture mappings that conflicted with navigation.

This is enough to continue using and improving the harness, but not enough to
claim standalone product-market fit.
