# Firestore Security Specification

## Data Invariants
1. A tournament must have a `name`, `creatorId`, and `status`.
2. A tournament's `creatorId` must match the authenticated user's ID upon creation.
3. Only the `creatorId` user can update or delete a tournament.
4. If `isPublic` is true, anyone can read the tournament.

## The Dirty Dozen Payloads
1. **Unauthenticated Write**: Creating a tournament without being signed in.
2. **Identity Spoofing**: Creating a tournament with someone else's `creatorId`.
3. **Ghost Field Update**: Injecting a field like `isAdmin: true` during update.
4. **Unauthorized Update**: Modifying a tournament created by another user.
5. **Unauthorized Delete**: Deleting a tournament created by another user.
6. **Resource Poisoning**: Sending a 1MB string as the tournament name.
7. **Bypassing Immutable Fields**: Attempting to change `creatorId` after creation.
8. **Invalid Status**: Setting status to something other than `configuring`, `live`, or `completed`.
9. **Private Scraping**: Attempting to read a tournament where `isPublic` is false (if supported).
10. **Orphaned Write**: Creating a team for a non-existent tournament (if using sub-collections).
11. **State Shortcut**: Moving from `configuring` directly to `completed` without `live` (if logic enforced).
12. **ID Poisoning**: Using a 2KB string as a tournament ID.

## Firestore Rules Pattern
We will use the Master Gate pattern. Only creators can write. Everyone can read if public.
