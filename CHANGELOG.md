# Changelog

Release notes for app-payments-kit, newest first. Each version is tagged in git (`v2.5.0`).

## 2.9.0

Nothing to change in apps. iPhone purchases work as before.

- **Google Play plan changes replace the current subscription.** Moving from Monthly to Yearly on Android now replaces the current Google Play subscription at its renewal (as the App Store does), instead of starting a second one and billing twice.
- **A subscription is never sold twice across stores.** When the App Store, Google Play or the website already bills the person, buying on the other phone is refused with one sentence that says where it is billed and where to manage it (`billedByAppStore`, `billedByGooglePlay`, `billedOnWeb` in `PaymentMessages`).
- **Manage opens the store that bills it.** `renewal()` carries `billedBy` ('app_store', 'google_play', 'web' or 'other'); `manageUrl()` opens that store's page, and Apple's sheet is skipped for a subscription Google Play or the website bills.

## 2.8.0

Nothing to change in apps.

- **Faster first answer at launch.** When this phone remembers the account's tier from the store (free, or paid and not yet ended), `watch()` reports it as soon as it is read, a few milliseconds after the call, with `remembered: true` on a paid tier. Before, it held it back until the store answered or 5 seconds had passed. The store's answer follows and is reported again. With nothing remembered, or a paid tier whose end date has passed, it still waits for the store (up to 5 seconds) as before, and it still waits for the account row when there is a backend.
- Before the store answers, the same state is not reported twice.
- Wording: "Tap Restore Purchases to turn it on here." names the button in Title Case.

## 2.7.0

- **A paying account no longer reads as Free at a launch with no connection.** If the store can't be reached when the app opens (offline, or RevenueCat's sign-in to the account fails or hangs), `watch()` now reports the account's last known tier and its dates (`remembered: true`), until that tier's end date. Before, it reported Free for the whole session, until the app went to the background and came back. The kit keeps each account's last answer from the store in `storage` (new option; `testerStorage` is used when it isn't given), tries the store again after 2 s, 4 s, 8 s and so on up to every 2 minutes, and at once when the new `onOnline` option says the device is back online. A store start that hangs counts as failed after 15 seconds.
- **No anonymous store id while the session is still loading.** `watch(undefined)` starts nothing and reports nothing, for an app that is still restoring who is signed in. `revenueCatMobile` no longer sets RevenueCat up on an anonymous id at a `start(null)` that comes before anyone signed in; it does so only when something needs the store. Setting it up straight on the real account needs no network, while moving from an anonymous id needs a sign-in call that fails offline.
- **A RevenueCat `test_` key is refused in a release build.** It made the SDK show "Wrong API Key" and close the app. Now `ready` is false, so purchases read as not open, and the new `onError` option of `revenueCatMobile` (or the console) says why. Development builds still take it.
- **Trials keep their own length.** `Plan.trial` is the trial's period as the store sets it (MONTH × 1), so the screens can say "1-month free trial". `trialDays` is unchanged; it counts a month as 30 days, so use it only for day and week trials.
- **Payment problems from the store.** `renewal.billingIssue` is true when the store could not take the renewal payment (RevenueCat's `billingIssueDetectedAt`), so an app without a server can ask the person to update their card before the grace period ends.
- **`refresh()` keeps reading the server row for its whole 45 seconds** after the store shows a change from the manage sheet. Before, it stopped at the store's change and read the row only once, before the webhook had updated it. The store itself is still not asked again once it shows the change.

To adopt: pass `storage: AsyncStorage` (or keep `testerStorage`) and, if the app has NetInfo, `onOnline`. Pass `undefined` to `watch()` (app-subscriptions-kit 1.23.0: `userId={undefined}`) while sign-in is still loading, and don't call `stop()` then. Everything else works as before.

## 2.6.1

Nothing to change in apps.

- `renewal.trial` is left out (unknown) when the store doesn't say which period it is, instead of `false`.
- The checks after the manage sheet stop only on a change the person made (auto-renew, plan), as in 2.5.0. A trial turning paid no longer stops them early. Watchers still hear about it.

## 2.6.0

`renewal()` says whether the subscription is in its free trial (`trial: true` while RevenueCat's `periodType` is `TRIAL`), so an app can apply trial-only limits such as a smaller item count. The end of a trial also counts as a change for the checks after the manage sheet.

## 2.5.0

`openManage(onClosed?)` calls `onClosed` the moment Apple's manage sheet closes, before the store is asked again, so a page can show its loader at once (providers get it as a second argument; an older provider's sheet still triggers it once it returns). The checks after the sheet now stop only when auto-renew or the plan changes, not when the end date alone moves, so a fresher date can no longer end them before Apple's real answer arrives.

## 2.4.1

`watch()` also waits for the store's first answer (at most 5 seconds) before it reports, so a Premium account no longer reads "free" for a moment at every launch. The webhook turns away a path it does not know (404) instead of reading it as RevenueCat; the bare `/payments-webhook` still means RevenueCat.

## 2.4.0

after Apple's in-app manage sheet closes, `refresh()` looks again every 2 seconds for the first 12 seconds, then at 15, 20, 30 and 45 seconds, and stops as soon as the store's renewal differs from what it was before the sheet opened. `refresh(before?)` takes that earlier renewal (as text) to know when to stop.

## 2.3.3

signed out, buy, restore and the sync after the manage sheet first make sure the store is on an anonymous id (a log-out that failed quietly left it on the last person), so this phone's purchases never go to them. Signing in or out drops the later re-checks of an earlier `refresh()`.

## 2.3.2

the sync after Apple's manage sheet first makes sure the store is on the signed-in person, like buy and restore (`openManage(userId)` on providers). A newer `refresh()` replaces the later checks of an older one, so repeated calls no longer pile up timers.

## 2.3.1

after Apple's in-app manage sheet closes, RevenueCat mobile sends this phone's purchases to RevenueCat (`syncPurchasesForResult`), so a cancel or renew shows at once even when Apple's server notification is slow or not set up. `refresh()` now looks again at 4, 15 and 45 seconds.

## 2.3.0

`refresh()` asks the store again (not its saved copy) and updates every `watch()`, then looks twice more over the next 15 seconds. `openManage()` calls it when Apple's in-app sheet closes, so a cancel or renew shows at once. `loadOffer(id)` / `buyOffer(offer)` sell an App Store promotional offer to people who already subscribe (RevenueCat signs it with the In-App Purchase key uploaded to it); `loadOffer` is null where there is none. Providers can add `refresh?()`, `loadOffer?()` and `buyOffer?()`.

## 2.2.0

`watch()` states carry `renewal` (`until`, `willRenew`, `productId`) from the store's entitlement while the tier comes from the store. Providers can add `renewal?()`; both RevenueCat providers do.

## 2.1.0

`openManage()` on iPhone shows Apple's manage sheet inside the app (RevenueCat `showManageSubscriptions`), which also lists TestFlight and sandbox subscriptions. Android, the website, and any failure still open the store's manage page. Providers can add `openManage?()`.

## 2.0.1

`watch()` waits for the account's row before its first answer.

## Upgrading from 1.x to 2.0

`revenueCat` from `app-payments-kit/revenuecat` is now `revenueCatMobile` from `app-payments-kit/revenuecat-mobile`; its options are the same. Nothing else changed for apps.

