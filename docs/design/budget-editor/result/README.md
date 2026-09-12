# Budget editor browser results

Captured September 12, 2026 from the real `BudgetForm`, using bundled React and compiled `src/app/globals.css`.

These are **synthetic fixture screenshots**, not a signed-in household or production data. The fixture includes fixed, variable and irregular groups, a wrapping category name, missing/zero history, provisional history and a completed AI reason. Server-action, navigation and AI HTTP boundaries are controlled by the browser tests.

- [Desktop, 1440px](synthetic-desktop-1440.png): initial AI selection and historical matches.
- [Desktop savings target](synthetic-desktop-target-1440.png): native popover anchored below its trigger.
- [Mobile, 390px](synthetic-mobile-390.png): after tapping the previous budget reference; enabled dirty save.
- [Mobile whole-fill menu](synthetic-mobile-menu-390.png): expanded fill choices.

The wrapper matches the production main layout. The fixture omits the database-backed app header, month navigation and status chip; its heading labels the synthetic data. Since the Next font loader is absent, it explicitly uses the approved mockup's Apple SD Gothic Neo system fallback. Numeric inputs retain the real browser rendering.

Compared visually with `../01-desktop-editor.png` and `../05-mobile-390.png`: three desktop columns, mobile stacked references, group hierarchy, selection colors and native menu behavior are retained. Data, row counts, header shell and font loading differ, so this is a layout review rather than a pixel-identical baseline. Static captures park the pointer outside the editor and disable screenshot animations to finish transient hover/save colors.

During review the desktop manual caption was 48.5px below its input. The scoped CSS fix keeps captions 4–6px below inputs, including long category names and wrapping missing-origin captions; mobile layout is preserved.

Verification: 30 standalone browser tests passed, 698 unit tests passed, TypeScript/lint/build passed. The database-backed E2E and integration runs remain blocked because local Docker/Supabase is manually paused. They were ported but not executed.

Reproduce the fixture suite:

```sh
NODE_OPTIONS= pnpm exec playwright test --config=playwright.component.config.ts
```
