# Overview scroll behavior

Required behavior:

- First/root entry to Overview: top (scrollY 0).
- Clicking the already-active Overview tab: reset to root and top.
- Normal tab switching away from Overview: preserve its in-session state.
- Overview -> Look/Item -> Back: restore the exact previous Overview position.
- Overview -> Look -> Item -> Back -> Back: restore the original Overview position.
- Overview -> another main tab -> Overview: restore the previous Overview state/position.
- Do not reset Overview merely because it becomes active through navigation.

The existing tab navigation/state provider remains the source of truth. The helper
in src/lib/overview/scrollState.ts provides the same anchor + offset strategy
used for Explore.

## Navigation distinction

- While on `/overview` root, clicking Overview again resets to the root and scrolls to top.
- While on an Overview-owned detail route, the first Overview click returns to the remembered detail route/state.
- Only a second click once the Overview root is actually active performs the reset.
- Other tab behavior is unchanged.
