# Lessons learned

## Test the channel tab and URL that failed

Version 1.0.2 covered channel Videos URLs. It still reported the channel Home page as unsupported because the route classifier required a /videos suffix. The channel Home shelf already used a watched-progress bar the extension understood.

For a filtering report, capture the exact URL, popup status, card wrapper, and watched-progress marker. Test the reported URL with the extension installed in Chromium. Confirm the popup count, card visibility at the configured threshold, and temporary reveal using the ZIP intended for release.

## Check link colors in both YouTube themes

YouTube's Shorts search cards did not expose the text color variable used by the extension in a Chromium test. The fixed gray fallback had poor contrast against the dark background.

Use a fallback color for each theme. Open the affected page with the packaged extension in both themes and check the rendered text against its background.

## Keep the Short page fallback for missing fields

A valid player response can supply a duration and omit the publish date or creator name. The Short page can provide those fields elsewhere in its HTML. A script can also contain another statement after the player response.

Read the assigned JSON object before looking for missing fields. Reject an explicit video ID mismatch before using any page metadata. Test a partial response, a response followed by another statement, and a response for a different video.
