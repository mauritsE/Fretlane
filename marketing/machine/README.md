# Marketing machine

Posts a Fretlane Short / Reel twice a week (Tuesday and Friday, 18:30 Amsterdam time) and a post
for every release. It drafts posts, you approve them, and it posts them at their time.

```
Friday 07:07 UTC        marketing-draft.yml   record + render next week's 2 Shorts, upload media,
(or a release)                                 open a PR with previews and the text per platform
        │
you merge the PR  ───►  marketing/queue/*.json   (merging = approval; edit or delete files to change)
        │
at the slot             marketing-post.yml    verify the media is the approved file, then post
```

Phase 1 (this) does all of it except the actual posting: every channel in
[`channels.json`](channels.json) is off, so `marketing-post.yml` is a dry run that shows exactly
what each platform would get. Phase 2 adds the publishers.

## What's in a Short

1080×1920, about 25 s, the app's own audio at about −14 LUFS. Three formats rotate:

| Format | Shows |
| --- | --- |
| `play-along` | The song playing from bar 1, cursor following the notes. |
| `half-speed` | The opening at 50 %, then the same bars at 100 %. |
| `track-tour` | Same music, view switches lead → bass → drums (lead → rhythm → bass if there are no drums). |

Songs come from the songbook (public-domain melodies, our arrangements), least recently posted
first. No song repeats within 4 posts, Christmas songs only in December, and solo pieces never get
the track tour. All of that is in [`plan.ts`](plan.ts) and tested in `tests/marketing-plan.test.ts`.

**What is real:** every frame of footage is the production app, recorded with Playwright; the
sound is what the app played, tapped from its Web Audio output. Nothing is sped up. Each take
checks itself: it fails if the cursor didn't move, the app made no sound, or half speed wasn't
0.5. The text never promises a part the song doesn't have: it's built from the tracks the songbook
actually writes, and a test checks that against `demo/*.atex`.
**Drawn:** the text above the footage, the labels, and the end card.

Release posts are an image (1080×1350) for Instagram and Facebook; YouTube's API has no image
posts. The text comes from a `## What's new` section in the release notes. Without one, the post
gets a TODO and the PR says it can't go out until you write it.

## Files

| File | Does |
| --- | --- |
| `plan.ts` | Pure logic: slots, picking songs, copy per platform, validation, due posts. |
| `record.ts` | Records a take in the real app (frames + app audio). |
| `render.ts` | Composes the Short (ffmpeg + HTML overlays drawn by Playwright) and the release image. |
| `draft.ts` | Plans, records, renders, uploads and writes the queue files and PR text. |
| `post.ts` | Posts what's due. Dry run while the channels are off. |
| `queue.ts` | Paths and queue reading. |
| `../queue/` | Approved posts waiting for their time. |
| `../posted/` | What went out (from phase 2). |

Media isn't in git. With `--upload`, `draft.ts` attaches it to a pre-release called
`marketing-media` (it shows in the Releases list, but `releases/latest` ignores it). That gives
every file a public URL, which Instagram and Facebook need. The queue file stores each file's
sha256, and `post.ts` refuses to post a file that doesn't match.

## Run it locally

```bash
npm run build
npm run marketing:draft -- --from 2026-10-17T00:00:00Z --days 7    # media → marketing/work/machine/
npm run marketing:post -- --now 2026-10-20T16:40:00Z               # dry run as of that moment
```

Needs ffmpeg and Inter (`apt install fonts-inter`, or Inter and Inter Display installed). One Short
takes about 50 s to record and render.

## One-time setup

- **Settings → Actions → General → Workflow permissions:** tick *Allow GitHub Actions to create
  and approve pull requests*, or the draft workflow can't open its PR.
- PRs opened by a workflow don't start CI themselves; that's fine, they only add JSON.
- GitHub pauses scheduled workflows in a repo with no activity for 60 days. The weekly draft PRs
  count as activity once you merge them.

## Phase 2: posting for real

| Platform | You set up | Secret |
| --- | --- | --- |
| YouTube | Google Cloud project with YouTube Data API v3, OAuth client, a refresh token for the channel. Uploads stay private until Google approves an audit of the project. | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` |
| Instagram | Instagram professional (Creator or Business) account, linked to the Facebook Page. | `META_PAGE_TOKEN`, `INSTAGRAM_USER_ID` |
| Facebook | Facebook Page, and a Meta developer app (can stay in development mode for your own accounts). | `META_PAGE_TOKEN`, `FACEBOOK_PAGE_ID` |

Then switch the channel on in `channels.json`. Still to check: whether Instagram follows the
redirect GitHub uses for release downloads. If it doesn't, the media moves to Supabase storage.
