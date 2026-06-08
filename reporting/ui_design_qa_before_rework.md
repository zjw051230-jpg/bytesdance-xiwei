# Task 11.1-C UI Design QA Before Rework

## Scope

- Target: `http://127.0.0.1:5174/`
- Checked viewports: `1920x1080`, `1440x900`
- Baseline screenshots:
  - `F:\字节比赛\最终程序\reporting\designqa-before-1920x1080.png`
  - `F:\字节比赛\最终程序\reporting\designqa-before-1440x900.png`
- DOM scan:
  - `font-size >= 40px`: none found
  - out-of-bounds elements: none found
  - red elements: only normal FAIL status dots/icons, no large red overlay
  - page scroll: `hasVerticalPageScroll=false`

## Design Issues Found

1. Top segmented control is still too bright and glossy; it pulls focus away from the current project and metrics.
2. Overall contrast relies too heavily on bordered boxes; the page still reads like a traditional admin dashboard.
3. The center project header contains too many facts in a tight row, making the project name compete with branch/owner/time/status metadata.
4. Metric cards truncate key labels at 1440x900 (`需求覆...`, `DSL 规...`, etc.), which looks unfinished.
5. Metric cards repeat three sub-metrics plus run ID, causing the score ring to fight with dense text.
6. Score rings are visually loud relative to the small cards; the neon green dominates more than the product hierarchy needs.
7. Recent checkpoint rail has seven equal columns, producing cramped labels and narrow time blocks at 1440x900.
8. Timeline rows contain run ID, task pill, trigger text, branch, commit, score, status, clock, and duration all at once; scanability is weak.
9. Timeline badges and status chips use similar visual weight, so the row's primary content is not obvious.
10. Right current-task panel reads as a compressed definition list instead of an inspector summary; the 96/100 ring competes with the task fields.
11. Report approval area is visually boxed but not action-oriented; the approval buttons feel like small admin controls.
12. Artifacts list lacks file-type hierarchy and has tight icon/name/size spacing, so it does not feel like a polished macOS file list.
13. Risk and exception panel uses warning bullets that appear noisier than its low-risk content warrants.
14. Left pending reports queue is important but visually similar to ordinary lists; the approval state is not easy enough to scan.
15. Sidebar runs repeat status colors and badges in a way that makes the left rail feel more like a log dump than a calm product sidebar.
16. Typography weights are still too bold in many small labels, reducing the Apple-like quietness and hierarchy.
17. The page has enough glass treatment, but too many internal separators and chip outlines remain visually busy.
18. The top-right user/actions area has the right structure but the icon weight is close to primary controls, adding noise.

## P0 Findings

- Abnormal red overlay: not reproduced in DOM or generated screenshots. No huge red text, watermark, fixed overlay, or out-of-bounds red element was found.
- Required fix direction: keep explicit checks in final verification and reduce normal red FAIL visual intensity so it cannot be mistaken for an overlay.
- Single-screen layout: currently passes; must remain unchanged after rework.
