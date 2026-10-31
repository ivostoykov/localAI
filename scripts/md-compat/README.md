# Markdown compatibility harness (issue #18)

Assessment-only tooling for GitHub issue #18. It does not change the extension and is not part of the shipped build.

## What it does

Runs labelled synthetic fixtures through the real, unmodified project code:

- `src/jslib/content-extractor.js` (HTML to Markdown for the model)
- `src/jslib/solomd2html.js` (model Markdown to HTML for display)

and prints the actual output as `REPORT.md` plus `results.json`.

Two kinds of content are kept separate:

- Generated data: outputs and structural checks produced by a run.
- Manual grades: a person's assessment, stored in `grades.mjs` and tied to recorded source hashes.

## Run

```bash
node scripts/md-compat/run.mjs
```

Requires the `jsdom` devDependency already used by the test suite. Turndown is fetched on first run from the pinned URLs recorded in `harness.mjs`, checked against a sha256, and cached in `scripts/md-compat/.cache/`. It is not installed, vendored or shipped; the cache is ignored by git.

Regenerate `REPORT.md` rather than editing it. Fixtures live in `fixtures.mjs`; grades live in `grades.mjs`.

## Files

- `fixtures.mjs`: the labelled inputs only.
- `grades.mjs`: manual grades and the graded commit/source hashes.
- `checks.mjs`: structural checks computed from the generated outputs.
- `harness.mjs`: loaders for the project sources and the pinned Turndown copies, plus the renderer serialiser.
- `run.mjs`: runs the fixtures, checks and grades, then writes `REPORT.md` and `results.json`.
- `REPORT.md`: generated record, safe to attach to the issue.
- `results.json`: machine-readable form of the same run.

## Reading the results

- `bug`: valid input for the supported domain, wrong output.
- `partial`: some content or structure is lost.
- `unsupported`: input uses syntax outside the supported subset, or behaviour that may be intentional. No defect is claimed.
- `pass`: output matches the input structure for the tested case.

Counts are selected-fixture results from manual grading, not general accuracy. Automated check results are reported separately and are not a quality score. jsdom is not a browser; the defects recorded are DOM-order and string-replacement facts, so layout independence is expected but browser behaviour was not exercised here. No live page, site-specific extractor or model-answer quality is measured.

## Notes

- `hasVisibleText()` and `getARIAContext()` are sliced out of `src/content.js` by function name and evaluated as-is; no logic is copied.
- jsdom has no `CSS.escape`; the harness supplies a CSSOM-shaped polyfill for that one missing global. Checks P1 and P2 exercise the aria paths.
- The report records the run commit, the sha256 of each source file and the hashes the grades were assessed against, and warns when they diverge.
- `REPORT.md` treats HTML to Markdown to HTML as a diagnostic chain only. Production never runs both steps on the same text.
