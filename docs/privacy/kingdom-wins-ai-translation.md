# Privacy policy draft — automatic translation and safety checks for Kingdom Wins

**Status:** draft for review before release (migration 189). P2P Global has no
published privacy policy yet (Settings → About shows "not published yet"), so
this section must be added to the policy when it is published, and the policy
must be live before this feature reaches members. Not legal advice; please have
it reviewed.

---

## Suggested policy text

**Automatic safety checks on Kingdom Wins posts**

When you share a Kingdom Win, testimony or P2P Impact story, we check it
automatically against our community rules (for example, no advertising,
fundraising, payment requests or scams) before it appears.

If your post is not written in English, we send the text of your post — its
title, story, lesson and guided sections — to our AI service provider,
Anthropic, which translates it into English so the same checks can be applied.
We do not send your name, email address, photos or videos for this purpose.

The English translation is kept with your post so that our moderators can read
it if the post is reviewed or reported. Moderators may also see the original
post and the translation together when handling a report.

If a post cannot be checked automatically (for example, if translation is
unavailable), it waits for a moderator to review it before it appears. Photos
and videos are not checked automatically; anyone can report a post.

Anthropic processes this text on our behalf to provide the translation. [Add:
the provider's data-retention terms that apply to our account, international
transfer safeguards, and our legal basis for this processing.]

---

## What the system actually does (for the reviewer)

| Item | Detail |
|---|---|
| When | Only for posts being shared (not drafts) whose text is detected as not English |
| Data sent | Post text only: title, story, lesson learned, guided-section answers |
| Not sent | Name, username, email, profile, photos, videos, location |
| Provider | Anthropic API (model `claude-haiku-4-5-20251001`), same key and provider already used for lesson translation |
| Stored by P2P | English translation stored with the post (`p2p_kingdom_wins.screening`, staff-only); a short-lived server record used for the check is deleted after use or within 1 day |
| Who can see the translation | Kingdom Wins moderators and, for P2P Impact, its reviewers; never other members |
| Logs | Post text and translations are not written to server logs |
| If translation fails | The post is held for a moderator; it is never published unchecked |

## Checklist before release

- [ ] Privacy policy published, including the section above.
- [ ] Anthropic listed as a sub-processor; data processing terms in place.
- [ ] Confirm the provider data-retention setting that applies to the API key in use.
- [ ] Confirm international-transfer wording for your members' regions.
- [ ] In-app notice on the Share screen (done: "Posts in other languages are translated for this check by our AI provider (Anthropic).").
