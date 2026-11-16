# Changelog

Release notes for app-payments-kit, newest first. Each version is tagged in git (`v2.5.0`).

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

