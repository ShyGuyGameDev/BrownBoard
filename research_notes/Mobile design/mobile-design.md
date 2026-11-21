# Mobile design: what the research says, and what BrownBoard does with it

Researched 1 November 2026 for the phone layout of the room (board + canvas). Each finding names its source. Where only secondary write-ups were found, that is said. The last section maps findings to code.

## 1. Touch targets

- **Apple:** 44×44 pt minimum for anything tappable. Secondary summaries of the HIG agree on this figure. Apple's own HIG pages render client-side and could not be fetched, so it is not quoted here.
- **Material (Google):** 48×48 dp minimum, with about 8 dp between targets. The visible icon can be smaller (24 dp) if padding makes up the touch area. ([Android accessibility help: touch target size](https://support.google.com/accessibility/android/answer/7101858), [Compose `minimumInteractiveComponentSize`](https://kotlinlang.org/api/compose-multiplatform/material3/androidx.compose.material3/minimum-interactive-component-size.html))
- **WCAG 2.2:** 2.5.8 Target Size (Minimum, AA) is **24×24 CSS px**, or enough spacing. 2.5.5 (Enhanced, AAA) is **44×44**. 2.5.7 Dragging Movements (AA) says anything done by dragging must also be possible with single taps. ([summary](https://wcag.dock.codes/documentation/wcag22aa/))
- **Steven Hoober** (UXmatters, 2017): accuracy depends on where the target is. Targets near the centre of the screen can be about **7 mm**. Targets at the corners and edges need about **12 mm**. Those sizes catch about 95% of taps. People prefer to look at and tap the centre. Keep destructive controls away from frequent ones. ([Design for Fingers, Touch, and People, Part 1](https://www.uxmatters.com/mt/archives/2017/03/design-for-fingers-touch-and-people-part-1.php). The mm figures came from a summary of the truncated page, so check them before quoting.)

**Takeaway:** 44 px for primary controls on touch screens. Never go under 24 px. Every drag needs a tap alternative.

## 2. Grip and reach

- Hoober's 2013 field study of 1,333 people found 49% held the phone in one hand, 36% cradled it, and 15% used two hands. Users change grip often. ([UXmatters 2013](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php), [Smashing: The Thumb Zone](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users))
- The bottom of the screen is easiest for a thumb. The top corners are hardest. That is why primary navigation goes at the bottom.
- **Caveat** (NN/g, see §4): the *middle* of the screen is the most tappable area across all grips, so "put it at the bottom" is not a universal rule. It holds for persistent navigation, not for everything.

## 3. Navigation

- **NN/g, hidden vs. visible navigation** (179 participants, 2016): hiding navigation behind a menu cut how often people used it. On mobile, people used it 57% of the time when hidden and 86% when combo (part visible). Task difficulty rose and tasks were 15% slower than combo. Rule: **with 4 or fewer top-level destinations, show them all.** ([Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/))
- **Apple HIG and Material** (via secondary summaries): use a bottom tab bar for 3 to 5 top-level sections. The tab bar is about 49 pt tall on iOS and the navigation bar about 80 dp in M3. Mark the selected tab clearly (M3 puts a pill behind the icon).
- **Luke Wroblewski, *Mobile First*:** the constraints force priority. Put content and its main action first, and push secondary navigation and settings down.

## 4. Sheets, dialogs, and full screens

From NN/g's [Bottom Sheets: Definition and UX Guidelines](https://www.nngroup.com/articles/bottom-sheet/) (2023):

- Use bottom sheets for **short, contextual** tasks. Don't use them for long or complex content, and don't use them to replace a page.
- **Don't stack** sheets.
- Give the sheet a **visible Close button**. Don't rely on the grab handle alone.
- Let **Back** (button or gesture) close it.
- Use a modal sheet (with a dimmed backdrop) only when the user must act first.

Apple's sheets have a grabber, rest at set heights ("detents"), and can be dragged down to dismiss. ([WWDC21: Customize and resize sheets](https://developer.apple.com/videos/play/wwdc2021/10063/))

**Takeaway:** share, room settings and the room menu fit a bottom sheet. A card's detail is page-sized, so on a phone it is a **full screen** with a Close button that stays in reach.

## 5. Gestures

- Gestures have no visible affordance. Every hidden gesture needs a visible alternative, and a peek or hint helps people find it. ([GhostUI, arXiv 2026](https://arxiv.org/html/2601.19258), [Dolfy on swipe discoverability](https://www.dolfy.ai/blog/swipe-to-delete-gesture-discoverability-mobile-apps))
- **Kanban on phones:** Jira's mobile apps show one column at a time. You swipe sideways between columns and **long-press to pick up a card**. As an alternative to dragging, you change a card's status from a dropdown. ([Jira iPhone](https://confluence.atlassian.com/jmios/working-in-a-project-978219511.html), [Jira Android](https://ja.confluence.atlassian.com/display/JMAND/Work+in+a+Jira+Cloud+project+on+an+Android+device)) Mixing drag and scroll on the same surface causes accidental drags, so a deliberate hold must separate the two. ([Telerik feedback](https://feedback.telerik.com/aspnet-core-ui/1665926-taskboard-columns-cannot-be-horizontally-scrolled-on-a-mobile-device))
- **Whiteboards on touch:** in Miro, one finger drags the canvas, a pinch zooms, and a long-press then drag selects. ([Miro help](https://help.miro.com/hc/en-us/articles/360017731053)) A common complaint about FigJam and Miro: with a pen tool active, a one-finger pan draws by accident. Two fingers should always pan and zoom. ([Figma forum](https://forum.figma.com/t/option-to-specify-how-we-want-to-drag-the-workspace-on-tablet-one-finger-two-fingers-etc/41466), [Miro community](https://community.miro.com/ideas/only-draw-with-stylus-still-allows-a-finger-to-draw-when-pen-toolbar-is-open-17674))
- **Touch has no hover, right-click or double-click.** Anything revealed by hover must be visible on touch screens, and essential information must not live only in tooltips. ([Phoenix Group tooltip accessibility](https://compound.thephoenixgroup.com/latest/components/components/tooltip/accessibility-KmHGABOw-KmHGABOw))

## 6. Mobile-web mechanics

- **Viewport height:** `100vh` on phones includes space hidden behind browser toolbars. Use `100dvh`, with `100vh` declared first as a fallback. ([OpenReplay: 5 mobile web papercuts](https://blog.openreplay.com/5-mobile-web-papercuts-fixes/))
- **Safe areas:** add `viewport-fit=cover`, then pad edge-hugging UI (tab bars, top bars) with `env(safe-area-inset-*)`. (same)
- **iOS input zoom:** Safari zooms into any field whose text is under 16 px. Fix it with 16 px fields. Do not disable pinch zoom, because low-vision users rely on it. (same)
- **On-screen keyboard:** `interactive-widget=resizes-content` makes Chrome (108+) and Firefox (132+) on Android shrink the layout when the keyboard opens, so bottom bars move up. iOS Safari only shrinks the visual viewport. ([engineered.at](https://engineered.at/articles/control-the-viewport-resize-behavior-on-mobile-with-interactive-widget))
- **Sideways scrolling lists:** use `scroll-snap-type: x mandatory` with `overscroll-behavior-x: contain`, which also keeps the browser's back-swipe from firing. ([30 seconds of code](https://www.30secondsofcode.org/css/s/scroll-snap))
- **Detecting touch:** use `(pointer: coarse)` / `(hover: none)` for input type. Use width only for layout. ([CSS-IRL: detecting hover-capable devices](https://css-irl.info/detecting-hover-capable-devices/))

## 7. How BrownBoard applies this

The phone layout switches on at **640 px wide or less** (`MOBILE_QUERY` in `src/lib/viewport.ts`). Touch sizing switches on for any **coarse pointer**, phone or tablet.

| Finding | What changed |
|---|---|
| 44 px targets (§1) | Under `(pointer: coarse)`, icon buttons are 44 px and controls 40 px, set through the `--dv-size-*` tokens. |
| Visible top-level nav at the bottom (§2, §3) | Board and Canvas move from the header's segmented control to a **bottom tab bar** with labelled icons and a selected pill. |
| Content first, secondary down (§3) | The header becomes back, room name, live status and head count, then Share, notifications, and *you* (your avatar). Your avatar opens a **room sheet** with the people here (tap one to jump to them), room settings, sign in, theme, and leave. |
| Sheets: short tasks, X button, Back closes, no stacking (§4) | New `Sheet` component (`src/sheet.tsx`). Share and room settings become sheets on phones. It has a Close button, a grab handle you can drag down, and a scrim tap to close. Esc and **Back** also close it (`src/lib/back-to-close.ts`). Opening one sheet from another closes the first. |
| Page-sized content is a page (§4) | Card detail is **full screen** on phones. Its header (with Close) sticks to the top, and Back closes it. |
| One column at a time, a visible alternative to swiping (§5) | The board shows **one list at a time**, snapped. The next list peeks in from the edge, and a row of **list tabs** above shows where you are and jumps to any list. |
| A tap alternative to dragging (WCAG 2.5.7, Jira) (§1, §5) | Card detail's "in list ___" is now a **Move to list** picker, on every screen size. Lists are dragged only with a mouse. On touch, a swipe across a list header scrolls the board. |
| No hover on touch (§5) | The list Archive button is always visible on touch screens. Card hover buttons are hidden (tapping the card opens them in its detail). Tapping a list or room name renames it, since double-click doesn't exist. |
| Canvas: one finger moves, pinch zooms (§5) | With the Select tool, one finger on empty canvas **pans** instead of box-selecting. With other tools, one finger draws and two fingers pan and zoom, as before. |
| No keyboard or right-click on touch (§5) | Selecting with a finger shows a **selection bar** with Edit text, Duplicate, Arrange (layer order) and Delete. |
| Reach and hand position (§2) | Canvas tools sit in a full-width bar at the bottom that scrolls sideways. Zoom (just reset and fit, since pinch zooms) and settings go to the top right. Style panels move to the top, away from the drawing hand. |
| Mobile-web mechanics (§6) | `viewport-fit=cover` and `interactive-widget=resizes-content`, `100dvh`, safe-area padding, 16 px fields, `theme-color` following the app theme, the native share sheet (`navigator.share`) in Share. |

### Known gaps

- **Dragging cards on touch** relies on the browser's own HTML drag-and-drop. Recent iOS Safari and Android Chrome start it on a long-press, but there is no custom auto-scroll between lists while dragging. The Move picker is the dependable path.
- **Reordering lists** is mouse-only.
- **The canvas has no long-press menu.** Its actions are in the selection bar instead.
- **Onboarding and the rooms page** got the global fixes (16 px fields, safe areas, `dvh`) but no redesign. They already had some 640 px rules.
- **Not yet tested on real devices.** Back-button handling, iOS keyboard behaviour, and long-press drag in particular need a pass on an iPhone and an Android phone.
