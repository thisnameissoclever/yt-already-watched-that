# Lessons learned

## Test the channel tab and URL that failed

Version 1.0.2 covered channel Videos URLs. It still reported the channel Home page as unsupported because the route classifier required a /videos suffix. The channel Home shelf already used a watched-progress bar the extension understood.

For a filtering report, capture the exact URL, popup status, card wrapper, and watched-progress marker. Test the reported URL with the extension installed in Chromium. Confirm the popup count, card visibility at the configured threshold, and temporary reveal using the ZIP intended for release.
