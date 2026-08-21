# Explore scroll restoration fix

The Explore provider now freezes its scroll snapshot synchronously when navigation
starts, so transient Next/browser scroll-to-0 events cannot overwrite the saved
anchor/position. NavigationStateProvider captures the Explore snapshot before
switching tabs, and Explore resumes scroll tracking after restoration.

This is in-memory only and is cleared by a real browser reload.
