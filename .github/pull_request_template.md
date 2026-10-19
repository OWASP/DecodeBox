## What this changes

<!-- Explain the reasoning, not just the diff. What problem does this solve? -->

## Related issue

<!-- Closes #123 — or "none" if this stands alone. -->

## How it was tested

<!-- What did you run or click? Include the inputs you tried, especially malformed ones. -->

## Screenshots

<!-- Interface changes: before and after, in BOTH themes. Delete if not applicable. -->

---

## Checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` all pass locally
- [ ] Tests added or updated — including a case that would have failed before this change
- [ ] No `any` introduced in application code
- [ ] No `eval`, `new Function`, `dangerouslySetInnerHTML`, or `innerHTML` assignment
- [ ] No new runtime dependency (or it was discussed in an issue first, linked above)
- [ ] User-facing strings go through the i18n map, not hardcoded in components
- [ ] Layout uses logical CSS properties — verified it still renders correctly in RTL
- [ ] Keyboard navigable, with correct ARIA roles and visible focus
- [ ] Malformed and hostile input handled without crashing or hanging the tab

## For new operations

- [ ] Registered with a stable kebab-case `id` and searchable `aliases`
- [ ] Arguments declared with correct types — no custom UI written by hand
- [ ] Test vectors cover a normal case, an edge case, and malformed input
- [ ] Detection criteria declared, and deliberately conservative
