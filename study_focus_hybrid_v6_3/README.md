# Study Focus AI for YouTube v6.1 — Hybrid

V6 combines:
- Manual allowed/blocked channel filters
- Manual allowed/blocked title phrase filters
- Groq only for unknown videos
- Groq batching (up to 8 unknown videos per request)
- Persistent Groq decision cache
- Duplicate-pending protection
- YouTube interface cleaner

Decision priority:
1. Allowed Channel -> ALLOW
2. Blocked Channel -> BLOCK
3. Blocked Title Phrase -> BLOCK
4. Allowed Title Phrase -> ALLOW
5. Cached Groq decision
6. Unknown -> Groq batch

YouTube cleaner toggles include Topic Chips, Notification Bell, Home Feed, Home recommendations, Explore/Trending, Subscriptions list, Sidebar, Shorts, Related Videos, Comments, Live Chat, History, and Playlists.

Install:
1. Extract the ZIP.
2. Open chrome://extensions
3. Enable Developer mode.
4. Disable old Study Focus versions while testing.
5. Click Load unpacked.
6. Select study_focus_hybrid_v6.
7. Open Settings, add your filters, then enter Groq API key and click Save & Test Groq.
8. Reload YouTube.


## V6.1 Groq fix

V6.1 fixes the `Unexpected Groq response` test failure with reasoning models.

Changes:
- increases the test completion budget from 30 to 256 tokens
- uses hidden / low reasoning for GPT-OSS
- uses strict JSON Schema output on supported Groq models
- sends classification instructions in the user message for reasoning-model compatibility
- improves error messages when Groq returns empty or unexpected content
- classification output budget increased to 1800 tokens


## V6.3

Two master switches are available directly in the popup:

- Video filtering
- YouTube cleaner

The cleaner switch does not erase cleaner preferences. When it is OFF, all
interface-cleaner effects are temporarily disabled. Turning it ON restores the
previous individual cleaner choices.

Groq also has a separate Settings switch:
`Enable Groq AI fallback for unknown videos`.

When Groq is OFF, manual filters still work and unknown videos remain visible.
