# Explore scroll + eBay fix

Compared Milestone 12.2 against Milestone 11.

- Restored Milestone 11's working Explore anchor/scroll restoration mechanism.
- Removed the newer competing module-level snapshot/freeze mechanism.
- Kept the tab navigation provider and explicit active-tab reset behavior.
- Fixed the eBay `searchItemsOnce is not defined` regression.
- Search aggregation remains enabled; Explore keeps 20-item pages for valid eBay offsets.
